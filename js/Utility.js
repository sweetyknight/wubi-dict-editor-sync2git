const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');

// 导入全局配置 - 更新后的目录名称
const { CONFIG_FILE_PATH } = require('./Global');

// 在 Windows 平台上设置控制台编码为 UTF-8
if (os.platform() === 'win32') {
    try {
        child_process.execSync('chcp 65001', { stdio: 'ignore' });
    } catch (e) {
        console.warn('无法设置控制台编码为 UTF-8');
    }
}

// 词库变更日志功能
function logDictChange(fileName, action, word, code, priority, note) {
    try {
        const configPath = path.join(os.homedir(), CONFIG_FILE_PATH);
        const logDir = path.join(configPath, 'dict-logs');
        // 确保日志目录存在
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        // 创建日志文件名，每月一个文件
        const now = new Date();
        const logFileName = `dict_changes_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}.log`;
        const logFilePath = path.join(logDir, logFileName);
        
        // 格式化日志内容
        const timestamp = dateFormatter(now, 'yyyy-MM-dd hh:mm:ss');
        
        // 采用简单直观的方式解决对齐问题：将文件名和操作类型分开定位
        // 操作类型始终从第60个字符开始，这样无论文件名多长，操作类型都能对齐
        const fileNamePart = `[${timestamp}] ${fileName}`;
        // 计算需要补充多少空格才能达到固定位置
        const paddingCount = Math.max(1, 60 - fileNamePart.length);
        const padding = ' '.repeat(paddingCount);
        
        // 构建标准格式的日志内容
        const logContent = `${fileNamePart}${padding}| ${action} | 词条:${word} | 编码:${code} | 权重:${priority || ''} | 备注:${note || ''}\n`;
        
        // 追加到日志文件
        fs.appendFileSync(logFilePath, logContent, {encoding: 'utf8'});
        
        return true;
    } catch (err) {
        console.error('记录词库变更失败:', err);
        return false;
    }
}

function $(selector){
    return document.querySelector(selector)
}

// 抖动 dom 元素
function shakeDom(dom){
    let animateClass = 'shake';
    dom.classList.add('animated');
    dom.classList.add(animateClass);
    setTimeout(()=>{
        dom.classList.remove('animated')
        dom.classList.remove(animateClass)
    }, 250)
}

// 抖动 dom 元素 并 聚焦
function shakeDomFocus(dom){
    let animateClass = 'shake';
    dom.classList.add('animated');
    dom.classList.add(animateClass);
    setTimeout(()=>{
        dom.classList.remove('animated')
        dom.classList.remove(animateClass)
    }, 250)
    dom.focus()
}

// 获取字符串的实际 unicode 长度，如：一个 emoji 表情的正确长度应该为 1
function getUnicodeStringLength(str){
    if (typeof str !== 'string') return 0;
    let wordLength = 0
    for(let letter of str){
        wordLength = wordLength + 1
    }
    return wordLength
}

/**
 * 数组乱序算法
 * @param arr
 * @return {*}
 */
function shuffle(arr) {
    let length = arr.length,
        r = length,
        rand = 0;

    while (r) {
        rand = Math.floor(Math.random() * r--);
        [arr[r], arr[rand]] = [arr[rand], arr[r]];
    }
    return arr;
}


// 格式化时间，输出字符串
function dateFormatter(date, formatString) {
    formatString = formatString || 'yyyy-MM-dd hh:mm:ss'
    let dateRegArray = {
        "M+": date.getMonth() + 1,                      // 月份
        "d+": date.getDate(),                           // 日
        "h+": date.getHours(),                          // 小时
        "m+": date.getMinutes(),                        // 分
        "s+": date.getSeconds(),                        // 秒
        "q+": Math.floor((date.getMonth() + 3) / 3), // 季度
        "S": date.getMilliseconds()                     // 毫秒
    }
    if (/(y+)/.test(formatString)) {
        formatString = formatString.replace(RegExp.$1, (date.getFullYear() + "").substr(4 - RegExp.$1.length))
    }
    for (let section in dateRegArray) {
        if (new RegExp("(" + section + ")").test(formatString)) {
            formatString = formatString.replace(RegExp.$1, (RegExp.$1.length === 1) ? (dateRegArray[section]) : (("00" + dateRegArray[section]).substr(("" + dateRegArray[section]).length)))
        }
    }
    return formatString
}
// 已在文件顶部导入了CONFIG_FILE_PATH，此处导入其他需要的配置常量
const { CONFIG_FILE_NAME, DEFAULT_CONFIG } = require('./Global');

function readConfigFile() {
    let configPath = path.join(os.homedir(), CONFIG_FILE_PATH);
    try {
        let result = fs.readFileSync(path.join(configPath, CONFIG_FILE_NAME), {encoding: 'utf-8'});
        return JSON.parse(result);
    } catch (err) {
        return DEFAULT_CONFIG;
    }
}

// 简单 base64 加密/解密（防止明文直观泄漏，非强加密）
function encrypt(str) {
    return Buffer.from(str, 'utf8').toString('base64');
}
function decrypt(str) {
    return Buffer.from(str, 'base64').toString('utf8');
}

module.exports = {
    shakeDom, shakeDomFocus, getUnicodeStringLength, dateFormatter, shuffle, readConfigFile, encrypt, decrypt, logDictChange
}
