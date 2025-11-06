import path from 'path';
import fs from 'fs';

const filePrev = 'log';

// 创建日志目录
const logsDir = path.join('logs');
fs.mkdirSync(logsDir, { recursive: true });

// 存储当前日志文件信息
let currentLogDate = getDateStr();
let logFiles = {};

// 获取当前日期字符串 (YYYY-MM-DD)
function getDateStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// 初始化日志文件
function initLogFiles() {
    const dateStr = getDateStr();
    const logLevelList = ['debug', 'info', 'warn', 'error'];
    logFiles = {};

    for (const level of logLevelList) {
        const fileName = `${filePrev}-${level}-${dateStr}.log`;
        logFiles[level] = path.join(logsDir, fileName);
    }
}

// 检查是否需要切换到新日期的日志文件
function checkDateRoll() {
    const today = getDateStr();
    if (today !== currentLogDate) {
        currentLogDate = today;
        initLogFiles();
    }
}

// 初始化日志文件
initLogFiles();

// 每小时检查一次日期变化
setInterval(checkDateRoll, 60 * 60 * 1000); // 每小时检查一次

const logLevelList = ['debug', 'info', 'warn', 'error'];

export const getLogger = (jsFile, consoleLevel = 'debug') => {

    if (!jsFile) {
        const stack = new Error().stack;
        const stackLines = stack.split('\n');
        const callerLine = stackLines[2]; // 第二行是调用者的堆栈信息
        const callerPath = callerLine.match(/at\s+file:\/\/(.*?):\d+:\d+/);
        if (callerPath) {
            // 处理路径，去掉前导的 '/'
            let filePath = callerPath[1];
            if (filePath.startsWith('/')) {
                jsFile = filePath.slice(1); // 去掉前导的 '/'
            }
        }
    }

    const fileName = path.basename(jsFile);

    const log = (level, message, ...args) => {
        // 检查日期变化
        checkDateRoll();

        const time = new Date().toLocaleString();
        const formatted = `[${time}] [${level.toUpperCase()}] [${fileName}]: ${message} ${args && args.length > 0 ? ('[' + args.join(', ') + ']') : ''}`;

        try {
            fs.appendFileSync(logFiles[level], formatted + '\n');
        } catch (err) {
            // 如果写入文件失败，至少输出到控制台
            console.error('Failed to write to log file:', err);
        }

        if (logLevelList.slice(logLevelList.indexOf(consoleLevel)).indexOf(level) > -1) {
            console.log(formatted);
        }
    };

    return {
        info: (msg, ...args) => log('info', msg, ...args),
        debug: (msg, ...args) => log('debug', msg, ...args),
        warn: (msg, ...args) => log('warn', msg, ...args),
        error: (msg, ...args) => log('error', msg, ...args),
    };
};
