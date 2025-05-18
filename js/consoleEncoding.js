/**
 * 修复控制台中文编码显示问题
 * 针对Windows平台上可能出现的控制台中文乱码问题
 */
const os = require('os');
const util = require('util');
const child_process = require('child_process');

// 立即设置控制台代码页为UTF-8 (65001)
if (os.platform() === 'win32') {
    try {
        child_process.execSync('chcp 65001', { stdio: 'ignore' });
        process.env.LANG = 'zh_CN.UTF-8';
        process.env.LC_ALL = 'zh_CN.UTF-8'; 
    } catch (e) {
        // 忽略错误
    }
}

// 替换默认的console方法以确保Windows下的正确编码
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

            // 增强型的toString处理，处理对象、数组等
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

module.exports = { setupConsoleEncoding };
