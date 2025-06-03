// 引入并设置控制台编码修复 (必须在其他模块之前引入)
const { setupConsoleEncoding } = require('./encoding');
setupConsoleEncoding();

const fs = require('fs');
const path = require('path');
const os = require('os');
const { readConfigFile, encrypt, decrypt } = require('./Utility');
const { CONFIG_FILE_PATH, CONFIG_FILE_NAME } = require('./Global');

// 在 Windows 平台上设置控制台编码为 UTF-8
if (os.platform() === 'win32') {
    try {
        // 设置控制台代码页
        require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
        
        // 确保所有字符串操作都使用UTF-8编码
        Buffer.from('测试中文编码'); // 预热Buffer编码系统
    } catch (e) {
        console.warn('无法设置控制台编码为 UTF-8:', e.message);
    }
}

function getFilesToSync() {
    const config = readConfigFile();
    // 安全提示：如支持用户自定义文件名，需校验禁止 ../ 或绝对路径
    return Array.isArray(config.syncDictFiles) && config.syncDictFiles.length > 0
        ? config.syncDictFiles
        : [
            'wubi86_jidian.dict.yaml',
            'wubi86_jidian_user.dict.yaml',
            'wubi86_jidian_user_hamster.dict.yaml',
            'wubi86_jidian_extra.dict.yaml',
            'wubi86_jidian_extra_district.dict.yaml'
        ];
}

function getGithubConfig() {
    const config = readConfigFile();
    let token = config.githubToken || '';
    // 自动解密以 ENC: 开头的 token
    if (token.startsWith('ENC:')) {
        try {
            token = decrypt(token.slice(4));
        } catch (e) {
            console.error('Token 解密失败:', e.message);
            token = '';
        }
    }
    return {
        owner: config.githubOwner || '',
        repo: config.githubRepo || '',
        branch: config.githubBranch || '',
        token,
        folder: config.githubFolder || '' // 新增folder字段
    };
}

async function getOctokit() {
    const { Octokit } = await import('@octokit/core');
    const { token } = getGithubConfig();
    return new Octokit({ auth: token });
}

// 展示带确认按钮的错误弹窗
function showErrorDialog(mainWindow, errorMsg) {
    if (!mainWindow) return;
    
    // 使用自定义确认对话框
    return new Promise((resolve) => {
        mainWindow.webContents.send('showErrorDialog', errorMsg);
        if (setConfirmCreateRemoteFolderCallback) {
            setConfirmCreateRemoteFolderCallback((userOk) => {
                resolve(userOk);
            });
        } else {
            resolve(false);
        }
    });
}

// 更新配置文件中的最后同步时间
function updateLastSyncTime(syncTime = null) {
    try {
        const config = readConfigFile();
        config.lastSyncTime = syncTime || new Date().toISOString();
        
        const configPath = path.join(os.homedir(), CONFIG_FILE_PATH);
        if (!fs.existsSync(configPath)) {
            fs.mkdirSync(configPath, { recursive: true });
        }
        
        fs.writeFileSync(
            path.join(configPath, CONFIG_FILE_NAME),
            JSON.stringify(config, null, 2),
            { encoding: 'utf-8' }
        );
        
        console.log(`[更新配置] 记录同步时间: ${config.lastSyncTime}`);
        return true;
    } catch (error) {
        console.error('[更新配置] 记录同步时间失败:', error.message);
        return false;
    }
}

// 获取远程最新提交时间
async function getRemoteLastCommitTime() {
    try {
        const octokit = await getOctokit();
        const { owner, repo, branch } = getGithubConfig();
        
        const { data: commits } = await requestWithRetry(octokit, 'GET /repos/{owner}/{repo}/commits', {
            owner,
            repo,
            sha: branch,
            per_page: 1,
            headers: { 'X-GitHub-Api-Version': '2022-11-28' }
        });
        
        if (commits.length > 0) {
            return new Date(commits[0].commit.committer.date);
        }
        return null;
    } catch (error) {
        console.warn(`[获取远程提交时间] 失败:`, error.message);
        return null;
    }
}

// 获取北京时间（强制使用CST时区，避免本地时间错乱）
function getBeijingTime(date = null) {
    const targetDate = date || new Date();
    // 获取UTC时间并转换为北京时间（UTC+8）
    const beijingTime = new Date(targetDate.getTime() + (8 * 60 * 60 * 1000));
    return beijingTime;
}

// 检查本地同步状态，返回是否需要下载
async function checkSyncStatus(mainWindow = null) {
    try {
        const config = readConfigFile();
        
        // 解析本地同步时间，如果无效则使用初始时间
        let localLastSyncTime;
        try {
            localLastSyncTime = config.lastSyncTime ? new Date(config.lastSyncTime) : new Date("1970-01-01T00:00:00.000Z");
            // 验证时间是否有效
            if (isNaN(localLastSyncTime.getTime())) {
                console.warn(`[检查同步状态] 本地同步时间格式无效: ${config.lastSyncTime}`);
                localLastSyncTime = new Date("1970-01-01T00:00:00.000Z");
            }
        } catch (timeError) {
            console.warn(`[检查同步状态] 解析本地同步时间失败: ${timeError.message}`);
            localLastSyncTime = new Date("1970-01-01T00:00:00.000Z");
        }
        
        // 获取远程最新提交时间
        const remoteLastCommitTime = await getRemoteLastCommitTime();
        
        if (!remoteLastCommitTime) {
            const errorMsg = '无法连接到远程仓库或获取提交信息。\n\n可能的原因：\n1. 网络连接问题\n2. GitHub Token无效或过期\n3. 仓库不存在或无权限访问\n\n请检查网络连接和GitHub配置后重试。';
            console.error(`[检查同步状态] 无法获取远程提交时间`);
            
            // 如果有mainWindow，显示错误弹窗
            if (mainWindow && !mainWindow.isDestroyed()) {
                await showErrorDialog(mainWindow, errorMsg);
            }
            
            return { 
                needDownload: false, 
                message: null, 
                error: true, 
                errorMsg 
            };
        }
        
        // 使用北京时间进行比较，避免时区问题
        const beijingLocalTime = getBeijingTime(localLastSyncTime);
        const beijingRemoteTime = getBeijingTime(remoteLastCommitTime);
        
        console.log(`[检查同步状态] 本地同步时间(北京时间): ${beijingLocalTime.toISOString()}`);
        console.log(`[检查同步状态] 远程提交时间(北京时间): ${beijingRemoteTime.toISOString()}`);
        
        // 处理本地时间比远程时间新的异常情况
        if (beijingLocalTime > beijingRemoteTime) {
            const timeDiffMinutes = Math.round((beijingLocalTime - beijingRemoteTime) / (1000 * 60));
            console.warn(`[检查同步状态] 检测到本地时间比远程时间快 ${timeDiffMinutes} 分钟`);
            
            // 如果时间差异超过24小时，可能是本地时间错乱
            if (timeDiffMinutes > 24 * 60) {
                console.warn(`[检查同步状态] 本地时间可能错乱，时间差异过大: ${timeDiffMinutes} 分钟`);
                
                // 检查实际内容是否有差异
                try {
                    const diffResult = await checkDictsDiff('download');
                    if (diffResult.same) {
                        // 内容一致，强制同步远程时间
                        updateLastSyncTime(beijingRemoteTime.toISOString());
                        console.log(`[检查同步状态] 内容一致，已强制同步远程时间（修正本地时间错乱）`);
                        return { needDownload: false, message: null };
                    } else {
                        // 内容不一致但本地时间异常，需要用户选择
                        const message = `检测到时间异常：本地同步时间比远程提交时间快 ${timeDiffMinutes} 分钟。\n\n这可能是由于系统时间错乱导致的。建议执行"下载到本地"操作以确保数据同步。`;
                        return { 
                            needDownload: true, 
                            message,
                            remoteCommitTime: beijingRemoteTime.toISOString(),
                            timeAnomaly: true
                        };
                    }
                } catch (diffError) {
                    const errorMsg = `检查内容差异时发生错误：${diffError.message}\n\n可能的原因：\n1. 网络连接不稳定\n2. 远程仓库访问权限问题\n3. 本地文件访问权限问题\n\n请检查网络和权限设置后重试。`;
                    console.error(`[检查同步状态] 比较内容差异失败:`, diffError.message);
                    
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        await showErrorDialog(mainWindow, errorMsg);
                    }
                    
                    return { 
                        needDownload: false, 
                        message: null, 
                        error: true, 
                        errorMsg 
                    };
                }
            } else {
                // 时间差异较小，可能是正常的操作延迟，检查内容差异
                try {
                    const diffResult = await checkDictsDiff('download');
                    if (diffResult.same) {
                        // 内容一致，保持本地时间不变
                        console.log(`[检查同步状态] 内容一致，本地时间较新但差异不大，保持现状`);
                        return { needDownload: false, message: null };
                    }
                } catch (diffError) {
                    const errorMsg = `检查内容差异时发生错误：${diffError.message}\n\n可能的原因：\n1. 网络连接不稳定\n2. 远程仓库访问权限问题\n3. 本地文件访问权限问题\n\n请检查网络和权限设置后重试。`;
                    console.error(`[检查同步状态] 比较内容差异失败:`, diffError.message);
                    
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        await showErrorDialog(mainWindow, errorMsg);
                    }
                    
                    return { 
                        needDownload: false, 
                        message: null, 
                        error: true, 
                        errorMsg 
                    };
                }
            }
        }
        
        // 本地时间早于远程时间，正常情况
        if (beijingLocalTime < beijingRemoteTime) {
            // 检查实际内容是否有差异
            try {
                const diffResult = await checkDictsDiff('download');
                if (diffResult.same) {
                    // 内容一致但时间不同步，自动同步时间
                    updateLastSyncTime(beijingRemoteTime.toISOString());
                    console.log(`[检查同步状态] 内容一致，已自动同步远程时间`);
                    return { needDownload: false, message: null };
                } else {
                    // 内容不一致，需要下载
                    const message = `检测到远程仓库有更新（${beijingRemoteTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}）。\n\n为避免数据丢失，建议先执行"下载到本地"操作同步最新词典。`;
                    return { 
                        needDownload: true, 
                        message,
                        remoteCommitTime: beijingRemoteTime.toISOString()
                    };
                }
            } catch (diffError) {
                const errorMsg = `检查内容差异时发生错误：${diffError.message}\n\n可能的原因：\n1. 网络连接不稳定\n2. 远程仓库访问权限问题\n3. 本地文件访问权限问题\n\n为安全起见，建议执行"下载到本地"操作。`;
                console.error(`[检查同步状态] 比较内容差异失败:`, diffError.message);
                
                if (mainWindow && !mainWindow.isDestroyed()) {
                    await showErrorDialog(mainWindow, errorMsg);
                }
                
                // 出现错误时，保守起见仍提示需要下载
                const message = `远程仓库有更新，但检查差异时出现问题。\n\n为确保数据同步，建议执行"下载到本地"操作。`;
                return { 
                    needDownload: true, 
                    message,
                    remoteCommitTime: beijingRemoteTime.toISOString(),
                    hasError: true
                };
            }
        }
        
        // 时间相等，无需下载
        console.log(`[检查同步状态] 本地与远程时间一致，无需下载`);
        return { needDownload: false, message: null };
        
    } catch (error) {
        const errorMsg = `检查同步状态时发生错误：${error.message}\n\n可能的原因：\n1. 网络连接问题\n2. 配置文件损坏\n3. GitHub服务异常\n\n请检查网络连接和配置后重试。`;
        console.error(`[检查同步状态] 致命错误:`, error.message);
        
        if (mainWindow && !mainWindow.isDestroyed()) {
            await showErrorDialog(mainWindow, errorMsg);
        }
        
        return { 
            needDownload: false, 
            message: null, 
            error: true, 
            errorMsg 
        };
    }
}

async function checkGitHubConnection() {
    const octokit = await getOctokit();
    const { owner, repo, branch } = getGithubConfig();
    try {
        const { data } = await requestWithRetry(octokit, 'GET /repos/{owner}/{repo}', {
            owner,
            repo,
            headers: { 'X-GitHub-Api-Version': '2022-11-28' }
        });

        await requestWithRetry(octokit, 'GET /repos/{owner}/{repo}/branches/{branch}', {
            owner,
            repo,
            branch,
            headers: { 'X-GitHub-Api-Version': '2022-11-28' }
        });

        return { success: true, repoName: data.full_name, message: '成功连接到GitHub仓库: ' + data.full_name };    } catch (error) {
        let errorMessage = '';
        
        if (error.status === 404) {
            errorMessage = '仓库不存在或无访问权限，请检查用户名、仓库名是否正确';
        }
        else if (error.status === 401) {
            errorMessage = 'GitHub Token无效或已过期，请在配置中更新您的GitHub访问令牌';
        }
        else if (error.status === 403) {
            errorMessage = 'GitHub API 权限不足，请确保令牌具有 repo 权限';
        }
        else {
            errorMessage = '连接GitHub失败，请检查网络连接和GitHub配置';
        }
        
        // 安全：不要输出 token
        console.error('GitHub API error:', error.status, error.message);
        return { success: false, message: errorMessage };
    }
}

// 依赖主进程暴露的setConfirmCreateRemoteFolderCallback
let setConfirmCreateRemoteFolderCallback = null;
function setConfirmCreateRemoteFolderCallbackExport(cb) {
    setConfirmCreateRemoteFolderCallback = cb;
}

// 依赖主进程暴露的applyRimeCallback
let applyRimeCallback = null;
function setApplyRimeCallbackExport(cb) {
    applyRimeCallback = cb;
}

async function checkOrCreateRemoteFolder(octokit, {owner, repo, branch, folder}, mainWindow) {
    if (!folder) return {ok: true, folder: ''};
    try {
        // 检查文件夹是否存在
        await requestWithRetry(octokit, 'GET /repos/{owner}/{repo}/contents/{path}', {
            owner,
            repo,
            path: folder,
            ref: branch,
            headers: { 'X-GitHub-Api-Version': '2022-11-28' }
        });
        return {ok: true, folder};
    } catch (e) {
        if (e.status === 404) {
            // 通过主窗口弹窗询问用户是否创建
            return new Promise((resolve) => {
                mainWindow.webContents.send('confirmCreateRemoteFolder', folder);
                if (setConfirmCreateRemoteFolderCallback) {
                    setConfirmCreateRemoteFolderCallback((userOk) => {
                        if (userOk) {                            requestWithRetry(octokit, 'PUT /repos/{owner}/{repo}/contents/{path}', {
                                owner,
                                repo,
                                path: folder + '/.gitkeep',
                                message: `create folder ${folder}`,
                                content: Buffer.from('').toString('base64'),
                                branch,
                                headers: { 'X-GitHub-Api-Version': '2022-11-28' }
                            }).then(() => {
                                resolve({ok: true, folder});
                            }).catch(err => {
                                mainWindow.webContents.send('gitOperationResult', '创建远程文件夹失败: ' + err.message);
                                resolve({ok: false, folder});
                            });
                        } else {
                            mainWindow.webContents.send('gitOperationResult', '用户取消了创建远程文件夹操作');
                            resolve({ok: false, folder});
                        }
                    });
                }
            });
        } else {
            throw e;
        }
    }
}


// 检查本地和远程词库内容是否一致，返回 same 和 diffFiles
// 添加重试功能的请求包装器
async function requestWithRetry(octokit, endpoint, params, maxRetries = 3, delay = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {            console.log(`[重试请求] 尝试请求 ${endpoint} (尝试 ${attempt}/${maxRetries})`);
            const response = await octokit.request(endpoint, params);
            return response;
        } catch (error) {
            lastError = error;
            console.error(`[重试请求] 请求失败 (尝试 ${attempt}/${maxRetries}):`, error.message);
            
            // 如果是连接问题，等待后重试
            if (error.cause && (error.cause.code === 'ECONNRESET' || error.cause.code === 'ETIMEDOUT')) {            console.log(`[重试请求] 网络连接问题，${delay}ms后重试...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                // 每次重试增加延迟时间
                delay = delay * 1.5;
                continue;
            }
            
            // 如果是GitHub API限流，不再重试
            if (error.status === 403 && error.message.includes('rate limit')) {                console.error('[重试请求] GitHub API限流，无法继续请求');
                throw error;
            }
            
            // 对于404等确定性错误，不再重试
            if (error.status === 404) {
                throw error;
            }
            
            // 其他错误等待后重试
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay = delay * 1.5;
            }
        }
    }
    // 所有重试都失败了    console.error(`[重试请求] 在${maxRetries}次尝试后仍然失败`);
    throw lastError;
}

async function checkDictsDiff(type) {
    console.log(`[检查词库差异] 开始 ${type} 差异检查...`);
    
    try {
        const octokit = await getOctokit();
        const { owner, repo, branch, folder } = getGithubConfig();
        const config = readConfigFile();
        
        if (!config.rimeHomeDir) {
            console.log(`[检查词库差异] 错误: 未设置Rime目录`);
            return { same: false, msg: '未设置Rime目录', diffFiles: [], error: true, errorMsg: '未设置Rime目录' };
        }
        
        // 如果是上传操作，检查是否需要先下载
        if (type === 'upload') {
            const syncStatus = await checkSyncStatus();
            if (syncStatus.needDownload) {
                return { 
                    same: false, 
                    diffFiles: [], 
                    error: true, 
                    errorMsg: syncStatus.message,
                    needDownloadFirst: true
                };
            }
        }
        
        let allSame = true;
        const filesToSync = getFilesToSync();
        console.log(`[检查词库差异] 要检查的文件: ${filesToSync.join(', ')}`);
        let diffFiles = [];
        
        for (const file of filesToSync) {
            const filePath = path.join(config.rimeHomeDir, file);
            let localContent = '';
            if (fs.existsSync(filePath)) {
                localContent = fs.readFileSync(filePath, 'utf8');
            }
            let remoteContent = '';
            let remotePath = folder ? (folder + '/' + file) : file;
            
            try {
                // 使用带有重试机制的请求
                const { data } = await requestWithRetry(octokit, 'GET /repos/{owner}/{repo}/contents/{path}', {
                    owner,
                    repo,
                    path: remotePath,
                    ref: branch,
                    headers: { 'X-GitHub-Api-Version': '2022-11-28' }
                });
                
                // 检查是否是大文件（GitHub API 可能返回 blob 引用而不是直接内容）
                if (!data.content && data.git_url) {
                    // 使用 blob API 获取大文件内容，使用带重试机制的请求
                    const blobResponse = await requestWithRetry(octokit, 'GET {url}', {
                        url: data.git_url,
                        headers: { 'X-GitHub-Api-Version': '2022-11-28' }
                    });
                    
                    if (blobResponse.data && blobResponse.data.content) {
                        remoteContent = Buffer.from(blobResponse.data.content, 'base64').toString('utf8');
                    }
                } else if (data.content) {
                    // 正常处理常规文件内容
                    remoteContent = Buffer.from(data.content, 'base64').toString('utf8');
                }
            } catch (e) {
                if (e.status === 404) {
                    // 文件不存在，将差异添加到列表
                    allSame = false;
                    diffFiles.push(file);
                    continue;
                } else {
                    // 其他错误重新抛出
                    throw e;
                }
            }
            
            // 规范化换行符，防止因换行符不同导致比较失败
            const normalizedLocalContent = localContent.replace(/\r\n/g, '\n');
            const normalizedRemoteContent = remoteContent.replace(/\r\n/g, '\n');
            
            // 添加调试日志，记录文件比较结果
            console.log(`比较文件 ${file}:`,
                `本地长度: ${normalizedLocalContent.length}`,
                `远程长度: ${normalizedRemoteContent.length}`,
                `相同: ${normalizedLocalContent === normalizedRemoteContent ? '是' : '否'}`);
            
            if (normalizedLocalContent !== normalizedRemoteContent) {
                allSame = false;
                diffFiles.push(file);
                console.log(`文件 ${file} 在本地和远程之间存在差异`);
            }
        }
        
        console.log(`[检查词库差异] 差异检查完成。全部相同: ${allSame ? '是' : '否'}, 不同文件: ${diffFiles.length > 0 ? diffFiles.join(', ') : '无'}`);
        return { 
            same: allSame, 
            diffFiles
        };
    } catch (error) {
        console.error(`[检查词库差异] 错误:`, error);
        
        let errorMsg = '检查词库差异失败';
        
        if (error.status === 401) {
            errorMsg = 'GitHub Token 无效或已过期，请在配置中更新您的GitHub访问令牌';
        } else if (error.status === 403) {
            errorMsg = 'GitHub API 权限不足，请确保令牌具有 repo 权限';
        } else if (error.status === 404) {
            errorMsg = '找不到仓库或资源，请检查用户名、仓库名是否正确';
        } else if (error.cause && (error.cause.code === 'ECONNRESET' || error.cause.code === 'ETIMEDOUT')) {
            errorMsg = '网络连接问题，请检查您的网络连接后重试';
        } else {
            errorMsg = `错误: ${error.message}`;
        }
        
        return { 
            same: false, 
            diffFiles: [], 
            error: true, 
            errorMsg: errorMsg
        };
    }
}

// 只上传有差异的文件
async function uploadDictToGit(mainWindow) {
    const octokit = await getOctokit();
    const { owner, repo, branch, folder } = getGithubConfig();
    try {
        const connectionStatus = await checkGitHubConnection();
        if (!connectionStatus.success) {
            // 使用自定义对话框而不是简单消息
            await showErrorDialog(mainWindow, connectionStatus.message);
            return;
        }
        const config = readConfigFile();
        if (!config.rimeHomeDir) {
            await showErrorDialog(mainWindow, '请先在设置中选择Rime配置目录');
            return;
        }
        // 检查/创建远程文件夹
        const folderCheck = await checkOrCreateRemoteFolder(octokit, {owner, repo, branch, folder}, mainWindow);
        if (!folderCheck.ok) return;        // 先比对差异
        const diffResult = await checkDictsDiff('upload');
        if (diffResult.error) {
            await showErrorDialog(mainWindow, diffResult.errorMsg);
            return;
        }
          if (diffResult.same) {
            // 如果内容一致，同步远程时间到本地
            const remoteCommitTime = await getRemoteLastCommitTime();
            if (remoteCommitTime) {
                updateLastSyncTime(remoteCommitTime.toISOString());
                console.log(`[同步时间] 内容一致，已同步远程时间: ${remoteCommitTime.toISOString()}`);
            }
            mainWindow.webContents.send('gitOperationResult', '本地词库与远程仓库一致，无需上传');
            return;
        }
        // 获取配置中的主表文件名
        const mainDictFileName = config.mainDictFileName || 'wubi86_jidian.dict.yaml';
        // 同步所有有差异的文件，包括主表
        const filesToSync = diffResult.diffFiles;
        let results = [];        for (const file of filesToSync) {
            const filePath = path.join(config.rimeHomeDir, file);
            if (!fs.existsSync(filePath)) {
                // 记录到控制台但不添加到结果中
                console.error(`文件 ${file} 不存在，跳过上传`);
                continue;
            }
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                let sha;
                let remotePath = folder ? (folder + '/' + file) : file;
                try {
                    const { data } = await requestWithRetry(octokit, 'GET /repos/{owner}/{repo}/contents/{path}', {
                        owner,
                        repo,
                        path: remotePath,
                        ref: branch,
                        headers: {
                            'X-GitHub-Api-Version': '2022-11-28'
                        }
                    });
                    if (typeof data.sha === 'string' && data.sha.length > 0) sha = data.sha;
                } catch (e) {
                    if (e.status !== 404) throw e;
                }
                const putParams = {
                    owner,
                    repo,
                    path: remotePath,
                    message: `Update ${file}`,
                    content: Buffer.from(content).toString('base64'),
                    branch,
                    headers: {
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                };                if (typeof sha === 'string' && sha.length > 0) putParams.sha = sha;
                await requestWithRetry(octokit, 'PUT /repos/{owner}/{repo}/contents/{path}', putParams);
                results.push(`${file}`); // 只添加文件名，不添加"文件"和"上传成功"等额外信息
            } catch (err) {
                // 失败日志只打印到控制台，不添加到结果中
                console.error(`上传文件 ${file} 时出错:`, err);
            }
        }        if (filesToSync.length > 0) {
            // results数组现在直接包含了成功文件的文件名，不需要过滤和转换
            const successfulFiles = results;
            if (successfulFiles.length > 0) {
                // 获取远程最新提交时间并更新本地同步时间
                const remoteCommitTime = await getRemoteLastCommitTime();
                if (remoteCommitTime) {
                    updateLastSyncTime(remoteCommitTime.toISOString());
                } else {
                    // 如果无法获取远程时间，使用当前时间
                    updateLastSyncTime();
                }
                
                // 只显示成功上传的文件名列表，不再显示详细结果
                mainWindow.webContents.send('gitOperationResult', `已成功上传词典：\n${successfulFiles.join('\n')}`);
            } else {
                // 如果没有成功上传的文件，只显示简单提示，不显示详细结果
                mainWindow.webContents.send('gitOperationResult', `上传操作未能完成，请检查网络或权限`);
            }
        } else {
            mainWindow.webContents.send('gitOperationResult', '没有需要上传的词典');
        }} catch (error) {
        // 使用更友好的错误对话框，只显示简洁的错误消息
        let errorMsg = '上传失败';
        
        if (error.status === 401) {
            errorMsg = 'GitHub Token 无效或已过期，请在配置中更新您的GitHub访问令牌';
        } else if (error.status === 403) {
            errorMsg = 'GitHub API 权限不足，请确保令牌具有 repo 权限';
        } else if (error.status === 404) {
            errorMsg = '找不到仓库或资源，请检查用户名、仓库名是否正确';
        } else if (error.cause && (error.cause.code === 'ECONNRESET' || error.cause.code === 'ETIMEDOUT')) {
            errorMsg = '网络连接问题，请检查您的网络连接后重试';
        }
        
        await showErrorDialog(mainWindow, errorMsg);
        console.error('上传错误:', error);
    }
}

// 只下载有差异的文件
async function downloadDictFromGit(mainWindow) {
    const octokit = await getOctokit();
    const { owner, repo, branch, folder } = getGithubConfig();
    try {        const connectionStatus = await checkGitHubConnection();
        if (!connectionStatus.success) {
            // 使用自定义对话框而不是简单消息
            await showErrorDialog(mainWindow, connectionStatus.message);
            return;
        }
        const config = readConfigFile();
        if (!config.rimeHomeDir) {
            await showErrorDialog(mainWindow, '请先在设置中选择Rime配置目录');
            return;
        }
        // 检查/创建远程文件夹（下载时不存在直接提示）
        if (folder) {
            try {
                await requestWithRetry(octokit, 'GET /repos/{owner}/{repo}/contents/{path}', {
                    owner,
                    repo,
                    path: folder,
                    ref: branch,
                    headers: { 'X-GitHub-Api-Version': '2022-11-28' }
                });
            } catch (e) {                if (e.status === 404) {
                    await showErrorDialog(mainWindow, `远程仓库中不存在'${folder}'文件夹`);
                    return;
                }
                throw e;
            }
        }        // 先比对差异
        const diffResult = await checkDictsDiff('download');
        if (diffResult.same) {
            // 如果内容一致，同步远程时间到本地
            const remoteCommitTime = await getRemoteLastCommitTime();
            if (remoteCommitTime) {
                updateLastSyncTime(remoteCommitTime.toISOString());
                console.log(`[同步时间] 内容一致，已同步远程时间: ${remoteCommitTime.toISOString()}`);
            }
            mainWindow.webContents.send('gitOperationResult', '本地词库与远程仓库一致，无需下载');
            return;
        }

        // 获取配置中的主表文件名
        const mainDictFileName = config.mainDictFileName || 'wubi86_jidian.dict.yaml';
        // 同步所有有差异的文件，包括主表
        const filesToSync = diffResult.diffFiles;
        let results = [];        for (const file of filesToSync) {
            let remotePath = folder ? (folder + '/' + file) : file;
            try {
                const { data } = await requestWithRetry(octokit, 'GET /repos/{owner}/{repo}/contents/{path}', {
                    owner,
                    repo,
                    path: remotePath,
                    ref: branch,
                    headers: { 'X-GitHub-Api-Version': '2022-11-28' }
                });

                // 检查文件内容是否为空或不存在
                if (!data.content) {
                    // 对于大文件，GitHub API 可能返回不同的格式
                    // 需要使用 blob API 获取文件内容
                    if (data.git_url) {
                        const blobResponse = await requestWithRetry(octokit, 'GET {url}', {
                            url: data.git_url,
                            headers: { 'X-GitHub-Api-Version': '2022-11-28' }
                        });
                        
                        if (blobResponse.data && blobResponse.data.content) {
                            const content = Buffer.from(blobResponse.data.content, 'base64').toString('utf8');
                            fs.writeFileSync(path.join(config.rimeHomeDir, file), content, 'utf8');
                            results.push(`${file}`); // 只添加文件名，不添加额外信息
                        } else {
                            console.error(`从 blob API 获取 ${file} 内容失败`);
                        }
                    } else {
                        console.error(`文件 ${file} 内容为空`);
                    }
                } else {
                    // 正常处理文件内容
                    const content = Buffer.from(data.content, 'base64').toString('utf8');
                    if (content.trim() === '') {
                        console.error(`文件 ${file} 内容为空，跳过下载`);
                    } else {
                        fs.writeFileSync(path.join(config.rimeHomeDir, file), content, 'utf8');
                        results.push(`${file}`); // 只添加文件名，不添加额外信息
                    }
                }
            } catch (err) {
                // 错误信息只记录到控制台，不添加到结果中
                console.error(`下载文件 ${file} 时出错:`, err);
            }
        }        if (filesToSync.length > 0) {
            // results数组现在直接包含了成功文件的文件名，不需要过滤和转换
            const successfulFiles = results;
            if (successfulFiles.length > 0) {
                // 获取远程最新提交时间并更新本地同步时间
                const remoteCommitTime = await getRemoteLastCommitTime();
                if (remoteCommitTime) {
                    updateLastSyncTime(remoteCommitTime.toISOString());
                } else {
                    // 如果无法获取远程时间，使用当前时间
                    updateLastSyncTime();
                }
                
                // 检查是否需要自动部署
                const config = readConfigFile();
                if (config.autoDeployOnDownload) {
                    console.log('[下载完成] 开始自动部署输入法...');
                    try {
                        // 调用部署回调函数
                        if (typeof applyRimeCallback === 'function') {
                            applyRimeCallback();
                        }
                    } catch (deployError) {
                        console.error('[自动部署] 部署失败:', deployError.message);
                    }
                }
                
                // 只显示成功下载的文件名列表，不再显示详细结果
                const downloadMsg = `已成功下载词典：\n${successfulFiles.join('\n')}`;
                const deployMsg = config.autoDeployOnDownload ? '\n\n已自动部署输入法' : '';
                mainWindow.webContents.send('gitOperationResult', downloadMsg + deployMsg);
            } else {
                // 如果没有成功下载的文件，只显示简单提示，不显示详细结果
                mainWindow.webContents.send('gitOperationResult', `下载操作未能完成，请检查网络或远程仓库`);
            }
        } else {
            mainWindow.webContents.send('gitOperationResult', '没有需要下载的词典');
        }} catch (error) {
        // 使用更友好的错误对话框，只显示简洁的错误消息
        let errorMsg = '下载失败';
        
        if (error.status === 401) {
            errorMsg = 'GitHub Token 无效或已过期，请在配置中更新您的GitHub访问令牌';
        } else if (error.status === 403) {
            errorMsg = 'GitHub API 权限不足，请确保令牌具有 repo 权限';
        } else if (error.status === 404) {
            errorMsg = '找不到仓库或资源，请检查用户名、仓库名是否正确';
        } else if (error.cause && (error.cause.code === 'ECONNRESET' || error.cause.code === 'ETIMEDOUT')) {
            errorMsg = '网络连接问题，请检查您的网络连接后重试';
        }
        
        await showErrorDialog(mainWindow, errorMsg);
        console.error('下载错误:', error);
    }
}

// 导出需要的函数
module.exports = {
    uploadDictToGit,
    downloadDictFromGit,
    checkDictsDiff,
    checkGitHubConnection,
    showErrorDialog,
    checkSyncStatus,
    getRemoteLastCommitTime,
    setConfirmCreateRemoteFolderCallback: setConfirmCreateRemoteFolderCallbackExport,
    setApplyRimeCallback: setApplyRimeCallbackExport
};