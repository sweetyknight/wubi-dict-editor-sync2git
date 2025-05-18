const Vue  = require('../../node_modules/vue/dist/vue.common.prod')
const {ipcRenderer} = require('electron')
const {encrypt} = require('../../js/Utility')
const { DEFAULT_CONFIG } =  require('../../js/Global')
const DictMap = require('../../js/DictMap')


// Vue 2
const app = {
    el: '#app',
    data() {
        return {
            config: DEFAULT_CONFIG,
            dictMapContent: '', // 字典文件内容
        }
    },
    mounted() {
        this.heightContent = innerHeight - 47 - 20 - 10 + 3

        // RESPONSE OF FILE LIST
        ipcRenderer.on('responseFileList', (event, fileList) => {
            fileList.sort((a,b) => a.name > b.name ? 1: -1)
            // console.log('获取码表文件列表成功', fileList)
            if (this.config.fileNameList && this.config.fileNameList.length > 0){
                // console.log('已存在的码表名字对应：', this.config.fileNameList)
                // 如果已经存在设置过的名字对，过滤没有的加上
                let existFileNameMap = new Map()
                this.config.fileNameList
                    .filter(item => { // 以获取到的本地文件列表为主。过滤掉其它不存在文件的记录
                        return fileList.some(file => file.path === item.path )
                    })
                    .forEach(existFile => {
                        existFileNameMap.set(existFile.path, existFile)
                    })
                fileList.forEach(newFile => {
                    if (existFileNameMap.has(newFile.path)){

                    } else {
                        existFileNameMap.set(newFile.path, newFile)
                    }
                })
                let finalFileNameList = []
                // console.log('existFileNameMap：',existFileNameMap)
                existFileNameMap.forEach(item => {
                    finalFileNameList.push(item)
                })
                // console.log('finalFileNameList: ',finalFileNameList)
                this.$set(this.config, 'fileNameList', finalFileNameList)
            } else {
                this.$set(this.config, 'fileNameList', fileList)
                // [{ "name": "luna_pinyin.sogou", "path": "luna_pinyin.sogou.dict.yaml" }]
            }
        })

        // RESPONSE OF CONFIG
        ipcRenderer.on('ConfigWindow:ResponseConfigFile', (event, config) => {
            console.log('获取配置成功')
            this.config = config

            // v1.27 添加 mainDictFileName 字段
            if (!config.hasOwnProperty('mainDictFileName')) this.$set(this.config, 'mainDictFileName', 'wubi86_jidian.dict.yaml')

            // v1.15 添加 rimeExecDir 字段
            if (!config.hasOwnProperty('rimeExecDir')) this.$set(this.config, 'rimeExecDir', '')

            // after config is loaded, then request for fileList
            ipcRenderer.send('requestFileList')

        })

        ipcRenderer.send('ConfigWindow:RequestConfigFile')

        // 选取 rime 配置目录后保存
        ipcRenderer.on('ConfigWindow:ChosenRimeHomeDir', (event, dir) => {
            this.config.rimeHomeDir = dir[0]
        })
        // 选取 rime 程序目录后保存
        ipcRenderer.on('ConfigWindow:ChosenRimeExecDir', (event, dir) => {
            this.config.rimeExecDir = dir[0]
        })

        // 字典文件保存后
        ipcRenderer.on('ConfigWindow:SaveDictMapSuccess', () => {
            this.config.hasSetDictMap = true
        })

        // 读取字典文件的内容
        ipcRenderer.on('ConfigWindow:ShowDictMapContent', (event, fileName, filePath, fileContent) => {
            let dictMap = new DictMap(fileContent)
            let dictMapFileContent = dictMap.toExportString()
            ipcRenderer.send('ConfigWindow:SaveDictMapFile', dictMapFileContent) // 保存取到的单字字典文本
        })


        onresize = ()=>{
            this.heightContent = innerHeight - 47 - 20 - 10 + 3
        }
    },
    methods: {
        tipNotice(msg){
            this.loginTip = msg
            setTimeout(()=>{this.loginTip = ''}, 3000)
        },
        setDefaultSyncFiles() {
            this.$set(this.config, 'syncDictFiles', [
                'wubi86_jidian.dict.yaml',
                'wubi86_jidian_user.dict.yaml',
                'wubi86_jidian_user_hamster.dict.yaml',
                'wubi86_jidian_extra.dict.yaml',
                'wubi86_jidian_extra_district.dict.yaml'
            ])
        },
        chooseSyncFiles() {
            // 让主进程弹出文件选择器，初始目录为rimeHomeDir
            ipcRenderer.invoke('ConfigWindow:ChooseSyncDictFiles', this.config.rimeHomeDir).then(files => {
                if (Array.isArray(files) && files.length > 0) {
                    // 只保留文件名部分，去重
                    let newFiles = files.map(f => f.split(/[\\/]/).pop())
                    let all = (this.config.syncDictFiles || []).concat(newFiles)
                    // 去重
                    all = Array.from(new Set(all))
                    this.$set(this.config, 'syncDictFiles', all)
                }
            })
        },
        removeSyncFile(idx) {
            this.config.syncDictFiles.splice(idx, 1)
        },
        setInitFile(file){
            this.config.initFileName = file.path
        },
        setMainDictFile(file){
            this.config.mainDictFileName = file.path
        },
        setDictMap(){
            ipcRenderer.send('ConfigWindow:SetDictMapFile')
        },
        chooseRimeHomeDir(){
            ipcRenderer.send('ConfigWindow:ChooseRimeHomeDir')
        },
        chooseRimeExecDir(){
            ipcRenderer.send('ConfigWindow:ChooseRimeExecDir')
        },
        clearRimeHomeDir(){
            this.config.rimeHomeDir = ''
        },
        clearRimeExecDir(){
            this.config.rimeExecDir = ''
        },
    },
    watch: {
        config: {
            handler(newValue) {
                // 保存主题设置到localStorage，方便其他页面使用
                if (newValue.theme) {
                    localStorage.setItem('wubi-theme', newValue.theme);
                    
                    // 广播主题变更到其他窗口
                    ipcRenderer.send('theme-changed', newValue.theme);
                }
                
                switch (newValue.theme){
                    case "auto":
                        document.documentElement.classList.add('theme-auto');
                        document.documentElement.classList.remove('theme-dark');
                        document.documentElement.classList.remove('theme-white');
                        document.body.classList.add('theme-auto');
                        document.body.classList.remove('theme-dark');
                        break;
                    case "black":
                        document.documentElement.classList.remove('theme-auto');
                        document.documentElement.classList.add('theme-dark');
                        document.documentElement.classList.remove('theme-white');
                        document.body.classList.remove('theme-auto');
                        document.body.classList.add('theme-dark');
                        break;
                    case "white":
                        document.documentElement.classList.remove('theme-auto');
                        document.documentElement.classList.remove('theme-dark');
                        document.documentElement.classList.add('theme-white');
                        document.body.classList.remove('theme-auto');
                        document.body.classList.remove('theme-dark');
                        break;
                }
                // 如果 token 是新输入的明文，则进行加密
                if (newValue.githubToken && !/^ENC:/.test(newValue.githubToken)) {
                    newValue.githubToken = 'ENC:' + encrypt(newValue.githubToken);
                }
                // 保存配置时格式化输出
                ipcRenderer.send('ConfigWindow:RequestSaveConfig', JSON.stringify(this.config, null, 2));
            },
            deep: true
        },
    }
}

new Vue(app)
