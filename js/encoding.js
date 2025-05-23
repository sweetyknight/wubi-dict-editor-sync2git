/**
 * 统一的编码处理模块
 * 处理控制台和Electron应用程序中的中文编码问题
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const child_process = require('child_process');

// 导入配置文件路径
let CONFIG_FILE_PATH;
try {
    ({ CONFIG_FILE_PATH } = require('./Global'));
} catch (e) {
    CONFIG_FILE_PATH = '.wubi-config';
}

// 立即设置控制台代码页为UTF-8 (65001) - 在任何导入之前运行
if (os.platform() === 'win32') {
    try {
        child_process.execSync('chcp 65001', { stdio: 'ignore' });
        process.env.LANG = 'zh_CN.UTF-8';
        process.env.LC_ALL = 'zh_CN.UTF-8'; 
    } catch (e) {
        // 忽略错误
    }
}

// 引入iconv-lite模块进行编码转换（如果可用）
let iconv;
try {
    iconv = require('iconv-lite');
} catch (err) {
    console.warn('iconv-lite模块未找到，将使用内置缓冲区转换');
}

/**
 * 增强型的toString处理，处理对象、数组等
 * @param {*} obj 任何对象
 * @returns {string} 格式化的字符串表示
 */
function enhancedToString(obj) {
    if (obj === undefined) return 'undefined';
    if (obj === null) return 'null';

    if (typeof obj === 'string') {
        // 确保字符串编码正确
        return obj;
    }

    try {
        // 使用util.inspect处理对象
        return util.inspect(obj, { 
            depth: 2, 
            colors: false,
            breakLength: 120
        });
    } catch (e) {
        return String(obj);
    }
}

/**
 * 设置控制台的编码，主要用于命令行应用
 * @returns {boolean} 是否设置成功
 */
function setupConsoleEncoding() {
    // 只处理Windows平台
    if (os.platform() === 'win32') {
        try {
            // 保存原始console方法
            const originalConsoleLog = console.log;
            const originalConsoleError = console.error;
            const originalConsoleWarn = console.warn;
            const originalConsoleInfo = console.info;
            const originalConsoleDebug = console.debug;

            // 设置stdout和stderr的编码
            if (process.stdout && process.stdout.isTTY) {
                process.stdout.setEncoding('utf8');
            }
            
            if (process.stderr && process.stderr.isTTY) {
                process.stderr.setEncoding('utf8');
            }

            // 重写控制台方法
            console.log = function() {
                // 正确处理多参数情况
                const args = Array.from(arguments).map(arg => {
                    return enhancedToString(arg);
                });
                originalConsoleLog.apply(console, args);
            };

            console.error = function() {
                const args = Array.from(arguments).map(arg => {
                    return enhancedToString(arg);
                });
                originalConsoleError.apply(console, args);
            };

            console.warn = function() {
                const args = Array.from(arguments).map(arg => {
                    return enhancedToString(arg);
                });
                originalConsoleWarn.apply(console, args);
            };

            console.info = function() {
                const args = Array.from(arguments).map(arg => {
                    return enhancedToString(arg);
                });
                originalConsoleInfo.apply(console, args);
            };

            console.debug = function() {
                const args = Array.from(arguments).map(arg => {
                    return enhancedToString(arg);
                });
                originalConsoleDebug.apply(console, args);
            };

            // 设置环境变量
            process.env.LANG = 'zh_CN.UTF-8';
            
            // 尝试修改控制台代码页
            try {
                require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
            } catch (e) {
                // 忽略错误
            }

            return true;
        } catch (e) {
            // 如果出现错误，恢复原始控制台方法
            console.error('设置控制台编码失败:', e);
            return false;
        }
    }
    return true;
}

/**
 * 在Electron应用程序启动前执行的编码修复
 * 必须在应用程序主进程最开始调用，包括日志文件创建功能
 * @returns {string|undefined} 日志文件路径（如果创建成功）
 */
function fixElectronEncoding() {
    // 确保正确的编码支持，适用于所有平台
    process.stdout.setDefaultEncoding('utf8');
    process.stderr.setDefaultEncoding('utf8');
    
    // 1. 设置控制台代码页 (Windows专用)
    if (os.platform() === 'win32') {
        try {
            // 设置控制台代码页为UTF-8
            child_process.execSync('chcp 65001', { stdio: 'ignore' });
        } catch (e) {
            console.warn('无法设置控制台代码页:', e.message);
        }
    }

    // 2. 设置全局环境变量
    process.env.LANG = 'zh_CN.UTF-8';
    process.env.LC_ALL = 'zh_CN.UTF-8';
    process.env.PYTHONIOENCODING = 'utf-8';
    process.env.NODE_OPTIONS = '--no-warnings --max-http-header-size=16384';
    
    // 3. 修复Electron中的stderr和stdout编码
    if (process.stdout.isTTY) {
        process.stdout._handle.setBlocking(true);
    }
    if (process.stderr.isTTY) {
        process.stderr._handle.setBlocking(true);
    }

    // 3. 配置 Electron 应用程序的参数
    if (process.versions.electron) {
        process.env.ELECTRON_FORCE_WINDOW_MENU_BAR = 'true';
    }
    
    // 4. 创建日志目录和日志文件
    const logDir = path.join(os.homedir(), CONFIG_FILE_PATH, 'app-logs');
    try {
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        // 创建日志文件
        const logFile = path.join(logDir, `app-${new Date().toISOString().replace(/:/g, '-')}.log`);
        const logStream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf8' });
        
        // 保存原始的控制台方法
        const originalConsoleLog = console.log;
        const originalConsoleError = console.error;
        const originalConsoleWarn = console.warn;
        
        // 包装控制台方法以同时输出到日志文件
        console.log = function() {
            const args = Array.from(arguments).map(enhancedToString);
            const timestamp = `[${new Date().toISOString()}] [LOG] `;
            const message = timestamp + args.join(' ') + '\n';
            logStream.write(message);
            originalConsoleLog.apply(console, args);
        };
        
        console.error = function() {
            const args = Array.from(arguments).map(enhancedToString);
            const timestamp = `[${new Date().toISOString()}] [ERROR] `;
            const message = timestamp + args.join(' ') + '\n';
            logStream.write(message);
            originalConsoleError.apply(console, args);
        };
        
        console.warn = function() {
            const args = Array.from(arguments).map(enhancedToString);
            const timestamp = `[${new Date().toISOString()}] [WARN] `;
            const message = timestamp + args.join(' ') + '\n';
            logStream.write(message);
            originalConsoleWarn.apply(console, args);
        };
        
        // 记录应用启动信息
        console.log('应用启动', process.argv);
        console.log('操作系统:', os.platform(), os.release(), os.arch());
        console.log('Node.js 版本:', process.version);
        if (process.versions.electron) {
            console.log('Electron 版本:', process.versions.electron);
        }

        // 捕获未捕获的异常和拒绝的 Promise
        process.on('uncaughtException', (err) => {
            console.error('未捕获的异常:', err);
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            console.error('未处理的 Promise 拒绝:', reason);
        });

        return logFile;
    } catch (err) {
        console.error('创建日志文件失败:', err);
    }
}

// 导出所有函数
module.exports = {
    setupConsoleEncoding,
    fixElectronEncoding,
    enhancedToString
};
