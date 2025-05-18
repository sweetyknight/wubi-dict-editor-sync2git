// 在应用程序的最开始，修复编码（必须在任何其他导入之前）
const { fixElectronEncoding } = require('./js/electronEncoding');
const logFile = fixElectronEncoding();

// 引入并设置控制台编码修复
const { setupConsoleEncoding } = require('./js/consoleEncoding');
setupConsoleEncoding();

const {app, globalShortcut, BrowserWindow, Menu, ipcMain, shell, dialog, Notification} = require('electron')
const {exec} = require('child_process') 
const fs = require('fs') 
const os = require('os') 
const url = require("url") 
const path = require("path") 

// 在控制台输出编码相关诊断信息
console.log('==== 编码诊断信息 ====');
console.log('日志文件路径:', logFile || '未创建');
console.log('当前环境变量设置:');
console.log('LANG:', process.env.LANG);
console.log('LC_ALL:', process.env.LC_ALL);
console.log('PYTHONIOENCODING:', process.env.PYTHONIOENCODING);
console.log('控制台编码设置已完成');
console.log('======================')

const {log, readConfigFile} = require('./js/Utility')

const {
    IS_IN_DEVELOP, // 是否处于开发模式
    CONFIG_FILE_PATH, // 配置文件的路径
    CONFIG_FILE_NAME, // 配置文件的名称
    DEFAULT_CONFIG, // 默认的配置内容
    CONFIG_DICT_MAP_FILE_NAME} = require('./js/Global') // 引入全局配置
const plist = require("plist") // 引入 plist 模块，用于处理 macOS 的 plist 文件
const { uploadDictToGit, downloadDictFromGit, checkGitHubConnection } = require('./js/syncGit');

let mainWindow // 主窗口变量，用于存放主窗口实例
let fileList = [] // 文件目录列表，用于存放词库文件信息

// 创建主窗口的函数
function createMainWindow() {
    let width = IS_IN_DEVELOP ? 1800 : 1250
    let height = 800
    mainWindow = new BrowserWindow({ // 创建新的主窗口
        width,
        height,
        icon: __dirname + '/assets/appIcon/appicon.ico', // windows icon
        // icon: __dirname + '/assets/appIcon/linux.png', // linux icon
        webPreferences: {
            nodeIntegration: true, // 开启 node.js 集成
            contextIsolation: false // 关闭上下文隔离
        }
    })

    if (IS_IN_DEVELOP) {
        mainWindow.webContents.openDevTools() // 如果是开发模式，打开开发者工具
    }

    // 加载指定的 HTML 文件到主窗口
    mainWindow.loadURL( 
        url.format({
            pathname: path.join(__dirname, './view/index/index.html'),
            protocol: "file:",
            slashes: true
        })
    )
    // 当主窗口关闭时
    mainWindow.on('closed', function () {
        mainWindow = null
        if (configWindow) configWindow.close()
        if (toolWindow) toolWindow.close()
    })
    // 当主窗口显示时
    mainWindow.on('show', ()=> {
        console.log('main window:showed')
        mainWindow.send('MainWindow:onWindowShowed') // 向 vue 发送窗口显示的事件
    })    // 保存词库到文件
    ipcMain.removeAllListeners('saveFile');
    ipcMain.on('saveFile', (event, filename, yamlString) => {
        // // 检查配置中的主表文件名
        // const config = readConfigFile();
        // const mainDictFileName = config.mainDictFileName || DEFAULT_CONFIG.mainDictFileName;
        
        // // 如果是主表文件，提供警告但允许修改
        // if (filename === mainDictFileName) {
        //     mainWindow.webContents.send('gitOperationResult', `注意：您正在修改主表 ${mainDictFileName}，请谨慎操作`);
        // }
        
        fs.writeFile(path.join(getRimeConfigDir(), filename), yamlString, {encoding: "utf8"}, err => {
            if (!err) {
                console.log('saveFileSuccess')
                try {
                    applyRime() // 尝试应用 Rime 配置
                } catch (err) {
                    console.log('获取程序目录失败')
                }
                mainWindow.webContents.send('saveFileSuccess') // 向主窗口发送保存成功的事件
            }
        })
    })

    // 监听 window 的文件载入请求
    ipcMain.removeAllListeners('loadInitDictFile');
    ipcMain.on('loadInitDictFile', () => {
        let config = readConfigFile() // 读取配置文件
        readFileFromConfigDir(config.initFileName) // 从配置文件目录读取初始化文件
    })

    // 监听载入主文件内容的请求
    ipcMain.removeAllListeners('loadDictFile');
    ipcMain.on('loadDictFile', (event, filename) => {
        readFileFromConfigDir(filename)
    })

    // 监听载入次文件内容的请求
    ipcMain.removeAllListeners('MainWindow:LoadSecondDict');
    ipcMain.on('MainWindow:LoadSecondDict', (event, filename) => {
        let filePath = path.join(getRimeConfigDir(), filename)
        fs.readFile(filePath, {encoding: 'utf-8'}, (err, res) => {
            if (err) {
                console.log(err)
            } else {
                mainWindow.webContents.send('setTargetDict', filename, filePath, res)
            }
        })
    })

    // 监听载入主文件内容的请求
    ipcMain.removeAllListeners('loadMainDict');
    ipcMain.on('loadMainDict', () => {
        let config = readConfigFile()
        let mainDictFileName = config.mainDictFileName || DEFAULT_CONFIG.mainDictFileName
        fs.readFile(path.join(getRimeConfigDir(), mainDictFileName), {encoding: 'utf-8'}, (err, res) => {
            if (err) {
                console.log(err)
            } else {
                mainWindow.webContents.send('setMainDict', path.join(getRimeConfigDir(), mainDictFileName), res)
            }
        })
    })

    // 外部打开当前码表文件
    ipcMain.removeAllListeners('openFileOutside');
    ipcMain.on('openFileOutside', (event, filename) => {
        shell.openPath(path.join(getRimeConfigDir(), filename)).then(res => {
            console.log(res)
        }).catch(err => {
            console.log(err)
        })
    })
    ipcMain.removeAllListeners('GetFileList');
    ipcMain.on('GetFileList', () => {
        mainWindow.send('FileList', fileList)
    })

    // config 相关，载入配置文件内容
    ipcMain.removeAllListeners('MainWindow:RequestConfigFile');
    ipcMain.on('MainWindow:RequestConfigFile', () => {
        let config = readConfigFile() // 没有配置文件时，返回 false
        if (config) { // 如果有配置文件
            mainWindow.send('MainWindow:ResponseConfigFile', config) // 向窗口发送 config 内容
        }
    })
    // 保存配置文件内容
    ipcMain.removeAllListeners('saveConfigFileFromMainWindow');
    ipcMain.on('saveConfigFileFromMainWindow', (event, configString) => {
        writeConfigFile(configString, mainWindow)
    })

    // 响应所有请求 dictMap 的请求
    ipcMain.removeAllListeners('getDictMap');
    ipcMain.on('getDictMap', () => {
        let dictMapFilePath = path.join(getAppConfigDir(), CONFIG_DICT_MAP_FILE_NAME)
        let dictMapFileContent = readFileFromDisk(dictMapFilePath)
        if (dictMapFileContent) {
            if (mainWindow) mainWindow.send('setDictMap', dictMapFileContent, CONFIG_DICT_MAP_FILE_NAME, dictMapFilePath)
            if (toolWindow) toolWindow.send('setDictMap', dictMapFileContent, CONFIG_DICT_MAP_FILE_NAME, dictMapFilePath)
        } else {
            // 如果没有设置码表字典文件，使用默认配置目录中的码表文件作为字典文件
            let rimeWubiDefaultDictFilePath = path.join(getRimeConfigDir(), 'wubi86_jidian.dict.yaml')
            let originalDictFileContent = readFileFromDisk(rimeWubiDefaultDictFilePath)
            if (originalDictFileContent) {
                if (mainWindow) mainWindow.send('setDictMap', originalDictFileContent, CONFIG_DICT_MAP_FILE_NAME, dictMapFilePath)
                if (toolWindow) toolWindow.send('setDictMap', originalDictFileContent, CONFIG_DICT_MAP_FILE_NAME, dictMapFilePath)
            }
        }
    })

    // 保存选中词条到 plist 文件
    ipcMain.removeAllListeners('MainWindow:ExportSelectionToPlistFile');
    ipcMain.on('MainWindow:ExportSelectionToPlistFile', (event, wordsSelected) => {

        let wordsProcessed = wordsSelected.map(item => {
            return {
                phrase: item.word,
                shortcut: item.code
            }
        })
        let plistContentString = plist.build(wordsProcessed)
        let exportFilePath = path.join(os.homedir(), 'Desktop', 'wubi-jidian86-export.plist')

        fs.writeFile(
            exportFilePath,
            plistContentString,
            {encoding: 'utf-8'},
            err => {
                if (err) {
                    console.log(err)
                } else {
                    // notification
                    if (Notification.isSupported()) {
                        new Notification({
                            title: '已成功导出文件',
                            subtitle: `文件路径：${exportFilePath}`, // macOS
                            body: `文件路径：${exportFilePath}`
                        }).show()
                    }
                }
            })
    })

    // 载入文件内容
    ipcMain.removeAllListeners('MainWindow:LoadFile');
    ipcMain.on('MainWindow:LoadFile', (event, fileName) => {
        readFileFromConfigDir(fileName, mainWindow)
    })
    // 载入文件内容
    ipcMain.removeAllListeners('MainWindow:ApplyRime');
    ipcMain.on('MainWindow:ApplyRime', () => {
        applyRime()
    })

    // 上传到Git
    ipcMain.removeAllListeners('uploadToGit');
    ipcMain.on('uploadToGit', () => {
        const { uploadDictToGit } = require('./js/syncGit');
        uploadDictToGit(mainWindow);
    });

    // 从Git下载
    ipcMain.removeAllListeners('downloadFromGit');
    ipcMain.on('downloadFromGit', () => {
        const { downloadDictFromGit } = require('./js/syncGit');
        downloadDictFromGit(mainWindow);
    });

    // 检查本地和远程词库内容是否一致
    ipcMain.removeHandler('checkDictsDiff');
    ipcMain.handle('checkDictsDiff', async (event, type) => {
        const { checkDictsDiff } = require('./js/syncGit');
        return await checkDictsDiff(type);
    });
}

// 在主进程全局注册监听，转发renderer的confirmCreateRemoteFolderResult
let confirmCreateRemoteFolderCallback = null;
ipcMain.on('confirmCreateRemoteFolderResult', (event, userOk) => {
    if (typeof confirmCreateRemoteFolderCallback === 'function') {
        confirmCreateRemoteFolderCallback(userOk);
        confirmCreateRemoteFolderCallback = null;
    }
});

let toolWindow

function showToolWindow() {
    // 若已存在toolWindow则激活并返回
    if (toolWindow && !toolWindow.isDestroyed()) {
        toolWindow.focus();
        return;
    }
    // 仅允许主窗口打开
    if (!mainWindow || mainWindow.isDestroyed()) return;

    let width = IS_IN_DEVELOP ? 1400 : 1000
    let height = IS_IN_DEVELOP ? 600 : 600
    toolWindow = new BrowserWindow({
        width,
        height,
        icon: __dirname + '/assets/appIcon/appicon.ico', // windows icon
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    })
    toolWindow.setMenu(null); // 移除菜单栏

    if (IS_IN_DEVELOP) {
        toolWindow.webContents.openDevTools() // 打开调试窗口
    }

    toolWindow.loadURL(
        url.format({
            pathname: path.join(__dirname, 'view/tool/tool.html'),
            protocol: "file:",
            slashes: true
        })
    )
    toolWindow.on('closed', function () {
        let listeners = [
            'ToolWindow:RequestConfigFile',
            'ToolWindow:chooseDictFile',
            'ToolWindow:SaveFile',
            'ToolWindow:loadFileContent',
            'ToolWindow:openFileOutside',
            'ToolWindow:GetFileList',
            'ToolWindow:LoadTargetDict'
        ];
        listeners.forEach(item => {
            ipcMain.removeAllListeners(item);
        });
        toolWindow = null;
        if (mainWindow) mainWindow.show();
    });


    // 保存选中词条到 plist 文件
    ipcMain.on('ToolWindow:ExportSelectionToPlistFile', (event, wordsSelected) => {

        let wordsProcessed = wordsSelected.map(item => {
            return {
                phrase: item.word,
                shortcut: item.code
            }
        })
        let plistContentString = plist.build(wordsProcessed)
        let exportFilePath = path.join(os.homedir(), 'Desktop', 'wubi-jidian86-export.plist')

        fs.writeFile(
            exportFilePath,
            plistContentString,
            {encoding: 'utf-8'},
            err => {
                if (err) {
                    console.log(err)
                } else {
                    // notification
                    if (Notification.isSupported()) {
                        new Notification({
                            title: '已成功导出文件',
                            subtitle: `文件路径：${exportFilePath}`, // macOS
                            body: `文件路径：${exportFilePath}`
                        }).show()
                    }
                }
            })
    })
    // 选取码表文件目录
    ipcMain.on('ToolWindow:chooseDictFile', () => {
        let dictFilePath = dialog.showOpenDialogSync(toolWindow, {
            filters: [
                {name: 'Text', extensions: ['text', 'txt', 'yaml']},
            ],
            defaultPath: getRimeConfigDir(), // 默认打开Rime配置文件夹
            properties: ['openFile'] // 选择文件
        })
        console.log(dictFilePath)
        if (dictFilePath) {
            readFileFromDiskAndResponse(dictFilePath[0], toolWindow)
        }
    })

    // 监听载入主文件内容的请求
    ipcMain.on('ToolWindow:loadMainDict', () => {
        let mainDictFileName = 'wubi86_jidian.dict.yaml'
        fs.readFile(path.join(getRimeConfigDir(), mainDictFileName), {encoding: 'utf-8'}, (err, res) => {
            if (err) {
                console.log(err)
            } else {
                toolWindow.webContents.send('ToolWindow:setMainDict', path.join(getRimeConfigDir(), mainDictFileName), res)
            }
        })
    })

    // 保存词库到文件
    ipcMain.on('ToolWindow:SaveFile', (event, filePath, fileConentString) => {
        fs.writeFile(filePath, fileConentString, {encoding: "utf8"}, err => {
            if (!err) {
                console.log('saveFileSuccess')
                // applyRime() // 部署
                toolWindow.webContents.send('saveFileSuccess')
            }
        })
    })

    // 监听 window 的文件载入请求
    ipcMain.on('ToolWindow:loadFileContent', (event, filePath) => {
        readFileFromDiskAndResponse(filePath, toolWindow)
    })

    // 外部打开当前码表文件
    ipcMain.on('ToolWindow:openFileOutside', (event, filename) => {
        shell.openPath(path.join(getRimeConfigDir(), filename)).then(res => {
            console.log(res)
        }).catch(err => {
            console.log(err)
        })
    })

    ipcMain.on('ToolWindow:GetFileList', () => {
        toolWindow.send('ToolWindow:FileList', fileList)
    })

    // 监听载入次文件内容的请求
    ipcMain.on('ToolWindow:LoadTargetDict', (event, filename) => {
        let filePath = path.join(getRimeConfigDir(), filename)
        fs.readFile(filePath, {encoding: 'utf-8'}, (err, res) => {
            if (err) {
                console.log(err)
            } else {
                toolWindow.webContents.send('ToolWindow:SetTargetDict', filename, filePath, res)
            }
        })
    })

    // config 相关
    ipcMain.on('ToolWindow:RequestConfigFile', () => {
        let config = readConfigFile() // 没有配置文件时，返回 false

        if (config) { // 如果有配置文件
            if (toolWindow) { // 如果有配置文件
                toolWindow.send('ToolWindow:ResponseConfigFile', config) // 向窗口发送 config 内容
            }
        }
    })
}


// 读取文件 从硬盘
function readFileFromDisk(filePath) {
    try {
        return fs.readFileSync(filePath, {encoding: 'utf-8'})
    } catch (e) {
        return false
    }
}

// 读取文件并回馈给指定窗口
function readFileFromDiskAndResponse(filePath, responseWindow) {
    let fileName = path.basename(filePath) // 获取文件名
    let fileContent = readFileFromDisk(filePath)
    if (fileContent) {
        responseWindow.send('showFileContent', fileName, filePath, fileContent)
    } else {
        console.log('读取文件错误')
    }
}


let configWindow

function createConfigWindow() {
    // 若已存在configWindow则激活并返回
    if (configWindow && !configWindow.isDestroyed()) {
        configWindow.focus();
        return;
    }
    // 仅允许主窗口打开
    if (!mainWindow || mainWindow.isDestroyed()) return;

    let width = IS_IN_DEVELOP ? 1400 : 800
    let height = IS_IN_DEVELOP ? 600 : 600
    // TODO：打开配置窗口的时候，先创建配置文件夹，供后面保存配置文件和字典文件使用

    // 判断 config 文件夹是否存在
    let configDir = getAppConfigDir()
    console.log(configDir)
    if (!fs.existsSync(configDir)) {
        console.log('create config dir', configDir)
        fs.mkdirSync(configDir) // 创建目录

    }

    configWindow = new BrowserWindow({
        width,
        height,
        icon: __dirname + '/assets/appIcon/appicon.ico', // windows icon
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    })
    configWindow.setMenu(null); // 移除菜单栏

    if (IS_IN_DEVELOP) {
        configWindow.webContents.openDevTools() // 打开调试窗口
    }


    configWindow.loadURL(
        url.format({
            pathname: path.join(__dirname, 'view/config/config.html'),
            protocol: "file:",
            slashes: true
        })
    )
    configWindow.on('closed', function () {
        let listeners = [
            'requestFileList',
            'ConfigWindow:RequestSaveConfig',
            'ConfigWindow:ChooseRimeHomeDir',
            'ConfigWindow:SetDictMapFile',
        ];
        listeners.forEach(item => {
            ipcMain.removeAllListeners(item);
        });
        ipcMain.removeHandler('ConfigWindow:ChooseSyncDictFiles'); // 关闭时移除handle，防止重复注册
        configWindow = null;
        if (toolWindow) toolWindow.show();
        if (mainWindow) mainWindow.show();
    });

    // 载入文件列表
    ipcMain.on('requestFileList', () => {
        configWindow.send('responseFileList', fileList)
    })

    // config 相关
    ipcMain.on('ConfigWindow:RequestConfigFile', () => {
        let config = readConfigFile() // 没有配置文件时，返回 false
        if (config) { // 如果有配置文件
            if (configWindow) { // 如果有配置文件
                configWindow.send('ConfigWindow:ResponseConfigFile', config) // 向窗口发送 config 内容
            }
        }
    })

    // 保存配置文件内容
    ipcMain.on('ConfigWindow:RequestSaveConfig', (event, configString) => {
        writeConfigFile(configString)
    })

    // 选取配置文件目录
    ipcMain.on('ConfigWindow:ChooseRimeHomeDir', () => {
        let rimeHomeDir = dialog.showOpenDialogSync(configWindow, {
            properties: ['openDirectory'] // 选择文件夹
        })
        if (rimeHomeDir) {
            configWindow.send('ConfigWindow:ChosenRimeHomeDir', rimeHomeDir)
        }
    })

    // 选取输入法程序目录
    ipcMain.on('ConfigWindow:ChooseRimeExecDir', () => {
        let rimeExecDir = dialog.showOpenDialogSync(configWindow, {
            properties: ['openDirectory'] // 选择文件夹
        })
        if (rimeExecDir) {
            configWindow.send('ConfigWindow:ChosenRimeExecDir', rimeExecDir)
        }
    })

    // 选取编码字典文件
    ipcMain.on('ConfigWindow:SetDictMapFile', () => {
        // 获取文件码表文件路径，返回值为路径数组
        let dictMapPathArray = dialog.showOpenDialogSync(configWindow, {
            defaultPath: getRimeConfigDir(), // 默认为 Rime 配置文件目录
            filters: [
                {name: '码表文件', extensions: ['text', 'txt', 'yaml']},
            ],
            properties: ['openFile'] // 选择文件夹
        })
        if (dictMapPathArray && dictMapPathArray.length > 0) {
            let filePath = dictMapPathArray[0]
            let fileName = path.basename(filePath) // 获取文件名
            let fileContent = readFileFromDisk(filePath)
            if (fileContent) {
                configWindow.send('ConfigWindow:ShowDictMapContent', fileName, filePath, fileContent)
            } else {
                log('读取码表字典文件错误')
            }
        }
    })

    // 保存 DictMap 文件
    ipcMain.on('ConfigWindow:SaveDictMapFile', (event, fileContentString) => {
        let configPath = getAppConfigDir()
        console.log(configPath)
        fs.writeFile(
            path.join(configPath, CONFIG_DICT_MAP_FILE_NAME),
            fileContentString,
            {encoding: 'utf-8'},
            err => {
                if (err) {
                    console.log(err)
                } else {
                    configWindow.send('ConfigWindow:SaveDictMapSuccess')
                }
            })
    })

    // 选取需要同步的词典文件
    ipcMain.removeHandler('ConfigWindow:ChooseSyncDictFiles');
    ipcMain.handle('ConfigWindow:ChooseSyncDictFiles', async (event, rimeHomeDir) => {
        const result = await dialog.showOpenDialog({
            title: '选择需要同步的词典文件',
            defaultPath: rimeHomeDir || '',
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'YAML 词典', extensions: ['yaml', 'yml'] },
                { name: '所有文件', extensions: ['*'] }
            ]
        });
        if (result.canceled) return [];
        return result.filePaths;
    });
}


// config 文件保存在 用户文件夹下 / CONFIG_FILE_PATH/CONFIG_FILE_NAME 文件中
function writeConfigFile(contentString) {
    let configPath = getAppConfigDir()
    fs.writeFile(
        path.join(configPath, CONFIG_FILE_NAME),
        contentString, {encoding: 'utf-8'},
        err => {
            if (err) {
                console.log(err)
            } else {
                // 配置保存成功后，向主窗口发送配置文件内容
                if (toolWindow) toolWindow.send('ToolWindow:ResponseConfigFile', JSON.parse(contentString)) // 向窗口发送 config 内容
                if (mainWindow) mainWindow.send('MainWindow:ResponseConfigFile', JSON.parse(contentString)) // 向窗口发送 config 内容
            }
        })
}

app.on('ready', () => {
    createMainWindow()
    getDictFileList() // 读取目录中的所有码表文件
    createMenu() // 创建菜单

    // 添加主题变更广播监听器
    ipcMain.on('theme-changed', (event, theme) => {
        // 获取所有打开的窗口
        const allWindows = BrowserWindow.getAllWindows();
        // 向所有窗口广播主题变更
        allWindows.forEach(window => {
            if (!window.isDestroyed() && window.webContents !== event.sender) {
                window.webContents.send('theme-changed', theme);
            }
        });
    });

    // Register a 'CommandOrControl+i' shortcut listener.
    const ret = globalShortcut.register('CommandOrControl+Shift+Alt+I', () => {
        console.log('ctrl + shift + alt + i is pressed')
        mainWindow.show()
    })

    // FOR YG777
    // Register a shortcut listener.
    // const retF3 = globalShortcut.register('F3', () => {
    //     console.log('key F3 is pressed')
    //     mainWindow.show()
    // })

    // // Register a shortcut listener.

    if (!ret) {
        console.log('registration failed')
    }

    // Check whether a shortcut is registered.
    console.log(globalShortcut.isRegistered('CommandOrControl+Shift+Alt+I'))

})


app.on('will-quit', () => {
    // Unregister a shortcut.
    globalShortcut.unregister('CommandOrControl+Shift+Alt+I')

    // Unregister all shortcuts.
    globalShortcut.unregisterAll()
})

app.on('window-all-closed', function () {
    // if (process.platform !== 'darwin') app.quit()
    app.quit()
})

app.on('activate', function () {
    if (mainWindow === null) {
        createMainWindow()
    }
})

// 读取文件 从配置文件目录
function readFileFromConfigDir(fileName, responseWindow) {
    let rimeHomeDir = getRimeConfigDir()
    let filePath = path.join(rimeHomeDir, fileName)
    fs.readFile(filePath, {encoding: 'utf-8'}, (err, res) => {
        if (err) {
            console.log(err)
        } else {
            if (responseWindow) {
                responseWindow.send('showFileContent', fileName, filePath, res)
            } else {
                mainWindow.webContents.send('showFileContent', fileName, filePath, res)
            }
        }
    })
}


// 匹配文件名，返回对应文件的名字
function getLabelNameFromFileName(fileName) {
    let map = [
        {name: 'iOS仓', path: 'wubi86_jidian_user_hamster.dict.yaml'},
        {name: '❤ 用户词库', path: 'wubi86_jidian_user.dict.yaml'},
        {name: '分类词库', path: 'wubi86_jidian_extra.dict.yaml'},
        {name: '极点主表', path: 'wubi86_jidian.dict.yaml'},
        {name: 'pīnyīn 词库', path: 'pinyin_simp.dict.yaml'},
        {name: '英文', path: 'wubi86_jidian_english.dict.yaml'},
        {name: '扩展-行政区域', path: 'wubi86_jidian_extra_district.dict.yaml'},

        // 测试词库
        {name: '测试 - 主表 ⛳', path: 'test_main.dict.yaml'},
        {name: '测试 - 分组 ⛳', path: 'test_group.dict.yaml'},
        {name: '测试 - 普通 ⛳', path: 'test.dict.yaml'},
    ]
    let matchedPath = map.filter(item => item.path === fileName)
    // 返回匹配的名字，或者返回原文件名
    return matchedPath.length > 0 ? matchedPath[0].name : fileName.substring(0, fileName.indexOf('.dict.yaml'))
}


// 创建 menu
function createMenu() {
    let menuStructure = [
        {
            label: '配置',
            submenu: [
                {
                    label: '配置',
                    click() {
                        createConfigWindow()
                    }
                },
                {
                    label: '刷新', // 刷新页面
                    click() {
                        refreshWindows()
                    }
                },
                {
                    label: '打开调试窗口',
                    click(menuItem, targetWindow) {
                        if (targetWindow) targetWindow.webContents.openDevTools()
                    }
                },
                {
                    label: '关闭调试窗口',
                    click(menuItem, targetWindow) {
                        if (targetWindow) targetWindow.webContents.closeDevTools()
                    }
                },
            ]
        },
        {
            label: '编辑',
            role: 'editMenu'
        },
        {
            label: '文件夹',
            submenu: [
                {
                    label: '打开 Rime 配置文件夹', click() {
                        shell.openPath(getRimeConfigDir())
                    }
                },                {
                    label: '打开 Rime 程序文件夹', click() {
                        const rimePath = getRimeExecDir();
                        if (rimePath) {
                            shell.openPath(rimePath);
                        } else {
                            dialog.showMessageBox({
                                type: 'error',
                                title: '错误',
                                message: '找不到Rime程序文件夹',
                                detail: '请在配置中手动设置Rime程序文件夹路径'
                            });
                        }
                    }
                },                {
                    label: '打开工具配置文件夹', click() {
                        let configDir = path.join(os.homedir(), CONFIG_FILE_PATH)
                        
                        // 检查配置文件夹是否存在，不存在则创建
                        if (!fs.existsSync(configDir)) {
                            try {
                                fs.mkdirSync(configDir, { recursive: true })
                                console.log(`创建配置文件夹: ${configDir}`)
                                
                                // 创建默认配置文件
                                const configFilePath = path.join(configDir, CONFIG_FILE_NAME)
                                if (!fs.existsSync(configFilePath)) {
                                    fs.writeFileSync(
                                        configFilePath,
                                        JSON.stringify(DEFAULT_CONFIG, null, 2),
                                        { encoding: 'utf-8' }
                                    )
                                    console.log(`创建默认配置文件: ${configFilePath}`)
                                      // 创建应用日志和词典日志目录
                                    const appLogDir = path.join(configDir, 'app-logs');
                                    const dictLogDir = path.join(configDir, 'dict-logs');
                                    
                                    if (!fs.existsSync(appLogDir)) {
                                        fs.mkdirSync(appLogDir, { recursive: true });
                                    }
                                    
                                    if (!fs.existsSync(dictLogDir)) {
                                        fs.mkdirSync(dictLogDir, { recursive: true });
                                    }
                                    
                                    // 向用户显示提示信息
                                    dialog.showMessageBox({
                                        type: 'info',
                                        title: '配置文件已创建',
                                        message: '已创建配置文件夹和默认配置文件',
                                        detail: `路径: ${configFilePath}\n已创建app日志目录和词典日志目录`
                                    })
                                }
                            } catch (err) {
                                console.error('创建配置文件夹失败:', err)
                                dialog.showErrorBox('错误', `无法创建配置文件夹: ${err.message}`)
                            }
                        }
                        
                        // 打开配置文件夹
                        shell.openPath(configDir)
                    }
                },
            ]
        },
        {
            label: '码表处理工具',
            submenu: [
                {
                    label: '码表处理工具',
                    click() {
                        showToolWindow()
                    }
                },
            ]
        },
        {
            label: '关于',
            submenu: [
                {label: '最小化', role: 'minimize'},
                {label: '关于', role: 'about'},
                {type: 'separator'},
                {label: '退出', role: 'quit'},
            ]
        },
    ]
    if (IS_IN_DEVELOP) {
        /*        menuStructure.push(

                )*/
    }
    let menu = Menu.buildFromTemplate(menuStructure)
    Menu.setApplicationMenu(menu)
}

// 刷新所有窗口内容
function refreshWindows() {
    if (mainWindow) mainWindow.reload()
    if (configWindow) configWindow.reload()
    if (toolWindow) toolWindow.reload()
}

// 读取配置目录中的所有码表文件
function getDictFileList() {
    let rimeFolderPath = getRimeConfigDir()
    fs.readdir(rimeFolderPath, (err, filePaths) => {
        if (err) {
            console.log(err)
        } else {
            // 筛选 .yaml 文件
            let yamlFileList = filePaths.filter(item => item.indexOf('.dict.yaml') > 0)
            // 匹配获取上面提前定义的文件名
            fileList = yamlFileList.map(item => {
                return {
                    name: getLabelNameFromFileName(item),
                    path: item
                }
            })
            // 排序路径
            fileList.sort((a, b) => a.name > b.name ? 1 : -1)
        }
    })
}

// 部署 Rime
function applyRime() {
    let rimeBinDir = getRimeExecDir()
    if (!rimeBinDir) {
        dialog.showMessageBox({
            type: 'error',
            title: '错误',
            message: '无法部署输入法',
            detail: '找不到Rime程序文件夹，请在配置中手动设置Rime程序文件夹路径'
        });
        return;
    }
    
    console.log(path.join(rimeBinDir, 'WeaselDeployer.exe'))
    switch (os.platform()) {
        case 'darwin':
            // macOS
            exec(`"${rimeBinDir}/Squirrel" --reload`, error => {
                console.log(error)
            })
            break
        case 'win32':
            // windows
            let execFilePath = path.join(rimeBinDir, 'WeaselDeployer.exe')
            exec(`"${execFilePath}" /deploy`, err => {
                if (err) {
                    console.log(err)
                }
            })
    }
}

// 根据系统返回 rime 配置路径
function getRimeConfigDir() {
    let userHome = os.homedir()
    let config = readConfigFile()
    if (!config.rimeHomeDir) { // 没有设置配置文件目录时
        switch (os.platform()) {
            case 'aix':
                break
            case 'darwin':
                return path.join(userHome + '/Library/Rime') // macOS
            case 'freebsd':
                break
            case 'linux':
                return path.join(userHome + '/.config/ibus/rime/')
            case 'openbsd':
                break
            case 'sunos':
                break
            case 'win32':
                return path.join(userHome + '/AppData/Roaming/Rime') // windows
        }
    } else {
        return config.rimeHomeDir
    }
}

function getAppConfigDir() {
    return path.join(os.homedir(), CONFIG_FILE_PATH)
}

// 返回  Rime 可执行文件夹
function getRimeExecDir() {
    switch (os.platform()) {
        case 'aix':
            break
        case 'darwin':
            // macOS
            return path.join('/Library/Input Methods/Squirrel.app', 'Contents/MacOS')
        case 'freebsd':
            break
        case 'linux':
            break
        case 'openbsd':
            break
        case 'sunos':
            break
        case 'win32':
            // windows
            let configContent = readConfigFile()
            if (configContent.rimeExecDir) { // 如果存在已配置的程序目录，使用它
                return configContent.rimeExecDir
            } else {
                // 定义可能的Rime安装路径
                const possiblePaths = [
                    'C:/Program Files (x86)/Rime',
                    'C:/Program Files/Rime'
                    // 可以添加更多可能的路径
                ];
                
                // 逐个检查可能的路径
                for (const pathToCheck of possiblePaths) {
                    try {
                        if (fs.existsSync(pathToCheck)) {
                            let execDirEntries = fs.readdirSync(pathToCheck, {withFileTypes: true});
                            execDirEntries.sort((a,b) => a.name > b.name ? 1 : -1);
                            let rimeDirEntries = execDirEntries.filter(item => item.name.includes('weasel')); // 过滤带 weasel 字符的文件夹
                            if (rimeDirEntries.length > 0) {
                                return path.join(pathToCheck, rimeDirEntries[rimeDirEntries.length - 1].name);
                            }
                        }
                    } catch (err) {
                        console.log(`查找Rime目录失败: ${pathToCheck}`, err.message);
                    }
                }
                
                // 如果没有找到，返回null，让调用方处理未找到的情况
                return null;
            }
    }
}

const syncGit = require('./js/syncGit');
syncGit.setConfirmCreateRemoteFolderCallback(cb => {
    confirmCreateRemoteFolderCallback = cb;
});

