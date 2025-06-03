// 在应用程序的最开始，修复编码（必须在任何其他导入之前）
const { fixElectronEncoding, setupConsoleEncoding } = require('./js/encoding');
const logFile = fixElectronEncoding();

// 设置控制台编码
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
    
    // 检查存储的主题设置
    const { session } = require('electron');
    const fs = require('fs');
    const path = require('path');
    const userDataPath = app.getPath('userData');
    let themeSource = 'system';  // 默认使用系统主题
    
    // 尝试从配置文件读取主题设置
    try {
        const config = readConfigFile();
        if (config && config.theme) {
            if (config.theme === 'black') {
                themeSource = 'dark';
            } else if (config.theme === 'white') {
                themeSource = 'light';
            } else if (config.theme === 'auto') {
                themeSource = 'system';
            }
        }
    } catch (e) {
        console.error('读取主题配置失败', e);
    }
    
    // 设置电子应用的原生主题
    const nativeTheme = require('electron').nativeTheme;
    nativeTheme.themeSource = themeSource;
    
    // 设置窗口背景色，在暗色主题中更好看
    const backgroundColor = themeSource === 'dark' ? '#1c1f24' : '#ffffff';    // 创建窗口配置 - 使用简化版，确保菜单栏可见
    const windowOptions = {
        width,
        height,
        icon: __dirname + '/assets/appIcon/appicon.ico', // windows icon
        // icon: __dirname + '/assets/appIcon/linux.png', // linux icon
        backgroundColor: backgroundColor, // 设置窗口背景色
        webPreferences: {
            nodeIntegration: true, // 开启 node.js 集成
            contextIsolation: false // 关闭上下文隔离
        }
    };
    
    // 原生黑暗模式，通过nativeTheme设置，不修改窗口样式
    if (process.platform === 'win32' && themeSource === 'dark') {
        console.log('正在使用暗色主题，但不修改标题栏样式以保证兼容性');
    }    // 创建主窗口
    mainWindow = new BrowserWindow(windowOptions)
    
    // 如果是暗色主题，为窗口添加焦点事件监听，防止标题栏颜色变化
    if (themeSource === 'dark' && process.platform === 'win32') {
        mainWindow.on('focus', () => mainWindow.setBackgroundColor('#1c1f24'));
        mainWindow.on('blur', () => mainWindow.setBackgroundColor('#1c1f24'));
    }

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
        
        // 检查文件是否为外部文件（绝对路径）
        const config = readConfigFile();
        let filePath;
        
        if (config && config.fileNameList) {
            // 查找匹配的文件配置项
            const configFile = config.fileNameList.find(file => file.path === filename);
            
            // 判断是否为外部绝对路径文件
            if (configFile && configFile.path.includes(':\\')) {
                filePath = configFile.path; // 直接使用绝对路径
            } else {
                filePath = path.join(getRimeConfigDir(), filename); // 使用Rime目录中的相对路径
            }
        } else {
            filePath = path.join(getRimeConfigDir(), filename); // 默认使用Rime目录
        }
        
        fs.writeFile(filePath, yamlString, {encoding: "utf8"}, err => {
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
    })    // 监听载入次文件内容的请求
    ipcMain.removeAllListeners('MainWindow:LoadSecondDict');
    ipcMain.on('MainWindow:LoadSecondDict', (event, filename) => {
        const config = readConfigFile();
        let filePath;
        
        // 检查文件是否为外部文件（绝对路径）
        if (config && config.fileNameList) {
            const configFile = config.fileNameList.find(file => file.path === filename);
            if (configFile && configFile.path.includes(':\\')) {
                filePath = configFile.path; // 直接使用外部绝对路径
            } else {
                filePath = path.join(getRimeConfigDir(), filename); // 使用Rime目录
            }
        } else {
            filePath = path.join(getRimeConfigDir(), filename); // 默认使用Rime目录
        }
        
        fs.readFile(filePath, {encoding: 'utf-8'}, (err, res) => {
            if (err) {
                console.log('读取次文件失败:', err)
            } else {
                mainWindow.webContents.send('setTargetDict', filename, filePath, res)
            }
        })
    })    // 监听载入主文件内容的请求
    ipcMain.removeAllListeners('loadMainDict');
    ipcMain.on('loadMainDict', () => {
        let config = readConfigFile()
        let mainDictFileName = config.mainDictFileName || DEFAULT_CONFIG.mainDictFileName
        
        // 检查主词典是否为外部文件（绝对路径）
        let filePath;
        if (config && config.fileNameList) {
            const configFile = config.fileNameList.find(file => file.path === mainDictFileName);
            if (configFile && configFile.path.includes(':\\')) {
                filePath = configFile.path; // 使用外部绝对路径
            } else {
                filePath = path.join(getRimeConfigDir(), mainDictFileName); // 使用Rime目录相对路径
            }
        } else {
            filePath = path.join(getRimeConfigDir(), mainDictFileName); // 默认使用Rime目录
        }
        
        fs.readFile(filePath, {encoding: 'utf-8'}, (err, res) => {
            if (err) {
                console.log('读取主码表失败:', err)
            } else {
                mainWindow.webContents.send('setMainDict', filePath, res)
            }
        })
    })// 外部打开当前码表文件
    ipcMain.removeAllListeners('openFileOutside');
    ipcMain.on('openFileOutside', (event, filename) => {
        const config = readConfigFile();
        let filePath;
        
        // 检查文件是否为外部文件（绝对路径）
        if (config && config.fileNameList) {
            const configFile = config.fileNameList.find(file => file.path === filename);
            if (configFile && configFile.path.includes(':\\')) {
                filePath = configFile.path; // 使用外部绝对路径
            } else {
                filePath = path.join(getRimeConfigDir(), filename); // 使用Rime目录相对路径
            }
        } else {
            filePath = path.join(getRimeConfigDir(), filename); // 默认使用Rime目录
        }
        
        shell.openPath(filePath).then(res => {
            console.log(res)
        }).catch(err => {
            console.log('打开文件失败:', err)
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
    });    // 检查本地和远程词库内容是否一致
    ipcMain.removeHandler('checkDictsDiff');    ipcMain.handle('checkDictsDiff', async (event, type) => {
        const { checkDictsDiff, showErrorDialog } = require('./js/syncGit');
        const result = await checkDictsDiff(type);
        
        // 如果发生错误，显示错误对话框
        if (result.error) {
            // 在下一个事件循环中显示错误对话框，以避免渲染进程还未准备好
            setTimeout(() => {
                showErrorDialog(mainWindow, result.errorMsg);
            }, 100);
        }
        
        return result;
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
    if (!mainWindow || mainWindow.isDestroyed()) return;    let width = IS_IN_DEVELOP ? 1400 : 1000
    let height = IS_IN_DEVELOP ? 600 : 600
      // 检查当前主题设置
    const nativeTheme = require('electron').nativeTheme;
    const themeSource = nativeTheme.themeSource;
    const backgroundColor = themeSource === 'dark' ? '#1c1f24' : '#ffffff';
    
    // 创建窗口配置 - 简化版
    const windowOptions = {
        width,
        height,
        icon: __dirname + '/assets/appIcon/appicon.ico', // windows icon
        backgroundColor: backgroundColor,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    };
      // 创建工具窗口
    toolWindow = new BrowserWindow(windowOptions)
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

    }    // 检查当前主题设置
    const nativeTheme = require('electron').nativeTheme;
    const themeSource = nativeTheme.themeSource;
    const backgroundColor = themeSource === 'dark' ? '#1c1f24' : '#ffffff';
    
    // 创建窗口配置 - 简化版
    const configWindowOptions = {
        width,
        height,
        icon: __dirname + '/assets/appIcon/appicon.ico', // windows icon
        backgroundColor: backgroundColor,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    };
    
    // 创建配置窗口
    configWindow = new BrowserWindow(configWindowOptions)
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
    })    // 选择码表文件
    ipcMain.on('ConfigWindow:ChooseDictFiles', (event, rimeHomeDir) => {
        // 使用提供的rimeHomeDir路径，如果没有则使用默认路径
        const defaultPath = rimeHomeDir || getRimeConfigDir();
        let dictFilePaths = dialog.showOpenDialogSync(configWindow, {
            defaultPath: defaultPath,
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'YAML Files', extensions: ['yaml'] }]
        });
        
        if (dictFilePaths && dictFilePaths.length > 0) {
            // 获取文件名列表，添加到config.fileNameList
            const dictFiles = [];
            
            for (const filePath of dictFilePaths) {
                const fileName = path.basename(filePath);
                
                // 验证文件是否可读，并且是否是词典文件（文件名以dict.yaml结尾）
                try {
                    // 尝试读取文件，检查是否可访问
                    fs.accessSync(filePath, fs.constants.R_OK);
                    
                    // 检查文件名是否是词典文件（是否以dict.yaml结尾）
                    if (fileName.endsWith('dict.yaml')) {
                        // 文件可读且是有效的词典文件，添加到列表
                        dictFiles.push({
                            name: getLabelNameFromFileName(fileName),
                            path: filePath.includes(':\\') ? filePath : fileName // 保存完整路径或文件名
                        });
                    } else {
                        // 文件不是词典文件，发送错误消息
                        configWindow.send('ConfigWindow:DictFileError', filePath, '不是有效的词典文件');
                    }
                } catch (err) {
                    // 文件不可读，发送错误消息
                    configWindow.send('ConfigWindow:DictFileError', filePath, err.message);
                }
            }
            
            if (dictFiles.length > 0) {
                configWindow.send('ConfigWindow:ChosenDictFiles', dictFiles);
            }
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
    // 输出系统和Electron版本信息，便于调试
    console.log('==== 系统和Electron信息 ====');
    console.log('操作系统:', process.platform, os.release());
    console.log('Electron版本:', process.versions.electron);
    console.log('Chromium版本:', process.versions.chrome);
    console.log('Node版本:', process.versions.node);
    console.log('==========================');
    
    createMainWindow()
    getDictFileList() // 读取目录中的所有码表文件
    createMenu() // 创建菜单
      // 程序启动后检查同步状态
    setTimeout(async () => {
        try {
            const { checkSyncStatus } = require('./js/syncGit');
            const syncStatus = await checkSyncStatus(mainWindow);
            
            if (syncStatus.needDownload && mainWindow && !mainWindow.isDestroyed()) {
                // 向主窗口发送同步状态提醒
                mainWindow.webContents.send('showSyncStatusWarning', syncStatus.message);
            }
        } catch (error) {
            console.log('[启动检查] 同步状态检查失败:', error.message);
        }
    }, 2000); // 延迟2秒执行，确保主窗口已完全加载
    
    // 添加主题变更广播监听器
    ipcMain.on('theme-changed', (event, theme) => {
        // 获取所有打开的窗口
        const allWindows = BrowserWindow.getAllWindows();
        
        // 设置原生窗口外观
        const nativeTheme = require('electron').nativeTheme;
        if (theme === 'black') {
            nativeTheme.themeSource = 'dark';            // 应用深色模式到所有窗口的原生部分
            allWindows.forEach(window => {
                // 在 Windows 平台上设置窗口背景色
                if (process.platform === 'win32') {
                    try {
                        // 设置固定背景色
                        window.setBackgroundColor('#1c1f24');
                        
                        // 为所有窗口添加焦点事件监听，防止标题栏颜色变化
                        // 移除已存在的监听器避免重复
                        window.removeAllListeners('focus');
                        window.removeAllListeners('blur');
                        
                        // 添加新的监听器
                        window.on('focus', () => window.setBackgroundColor('#1c1f24'));
                        window.on('blur', () => window.setBackgroundColor('#1c1f24'));
                        
                    } catch (error) {
                        console.log('设置窗口背景色失败:', error.message);
                    }
                }
            });
        } else if (theme === 'white') {
            nativeTheme.themeSource = 'light';
        } else if (theme === 'auto') {
            nativeTheme.themeSource = 'system';
        }
        
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
    let config = readConfigFile()
    let rimeHomeDir = getRimeConfigDir()
    
    // 检查文件是否位于外部目录
    let isExternalFile = false
    let externalPath = null
    
    if (config && config.fileNameList) {
        const configFile = config.fileNameList.find(file => file.path === fileName)
        if (configFile && configFile.path.includes(':\\')) {
            // 这是一个绝对路径的外部文件
            isExternalFile = true
            externalPath = configFile.path
        }
    }
      // 确定文件路径
    let filePath = isExternalFile ? externalPath : path.join(rimeHomeDir, fileName)
    
    // 检查文件名是否是词典文件（以dict.yaml结尾）
    const fileBaseName = path.basename(filePath);
    const isDictFile = fileBaseName.endsWith('dict.yaml');
    
    fs.readFile(filePath, {encoding: 'utf-8'}, (err, res) => {
        if (err) {
            console.log('读取文件失败:', err)
            
            // 发送错误消息到配置窗口，如果配置窗口存在
            if (configWindow && !configWindow.isDestroyed()) {
                configWindow.send('ConfigWindow:DictFileError', filePath, err.message);
            }
            
            // 如果读取失败，尝试在备用位置查找文件
            if (!isExternalFile && path.isAbsolute(fileName)) {
                // 如果失败且fileName是绝对路径，尝试直接读取
                fs.readFile(fileName, {encoding: 'utf-8'}, (err2, res2) => {
                    if (err2) {
                        console.log('备用读取也失败:', err2)
                        // 再次发送错误消息
                        if (configWindow && !configWindow.isDestroyed()) {
                            configWindow.send('ConfigWindow:DictFileError', fileName, err2.message);
                        }                    } else {
                        // 检查文件名是否是词典文件
                        const backupFileBaseName = path.basename(fileName);
                        if (backupFileBaseName.endsWith('dict.yaml')) {
                            // 是词典文件，传递内容
                            if (responseWindow) {
                                responseWindow.send('showFileContent', path.basename(fileName), fileName, res2)
                            } else {
                                mainWindow.webContents.send('showFileContent', path.basename(fileName), fileName, res2)
                            }
                        } else {
                            // 不是词典文件，发送错误消息
                            console.log('文件不是有效的词典文件:', fileName);
                            if (configWindow && !configWindow.isDestroyed()) {
                                configWindow.send('ConfigWindow:DictFileError', fileName, '文件不是有效的词典文件（必须以dict.yaml结尾）');
                            }
                            
                            // 虽然不是词典文件，但仍然显示内容以便用户查看
                            if (responseWindow) {
                                responseWindow.send('showFileContent', path.basename(fileName), fileName, res2)
                            } else {
                                mainWindow.webContents.send('showFileContent', path.basename(fileName), fileName, res2)
                            }
                        }
                    }
                })
            }        } else {
            // 验证文件是否是词典文件
            if (isDictFile) {
                // 是词典文件，传递内容
                if (responseWindow) {
                    responseWindow.send('showFileContent', fileName, filePath, res)
                } else {
                    mainWindow.webContents.send('showFileContent', fileName, filePath, res)
                }
            } else {
                // 不是词典文件，发送错误消息
                console.log('文件不是有效的词典文件:', filePath);
                if (configWindow && !configWindow.isDestroyed()) {
                    configWindow.send('ConfigWindow:DictFileError', filePath, '文件不是有效的词典文件（必须以dict.yaml结尾）');
                }
                
                // 虽然不是词典文件，但仍然显示内容以便用户查看
                if (responseWindow) {
                    responseWindow.send('showFileContent', fileName, filePath, res)
                } else {
                    mainWindow.webContents.send('showFileContent', fileName, filePath, res)
                }
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
    let config = readConfigFile()
    
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
            
            // 添加配置中存在但不在文件系统中的文件（可能是外部目录的文件）
            if (config && config.fileNameList && config.fileNameList.length > 0) {
                // 建立文件路径集合用于快速查找
                const existingPaths = new Set(fileList.map(file => file.path))
                
                // 添加配置中存在但不在文件系统中的文件
                config.fileNameList.forEach(configFile => {
                    if (!existingPaths.has(configFile.path)) {
                        fileList.push({
                            name: configFile.name,
                            path: configFile.path
                        })
                    }
                })
            }
            
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

