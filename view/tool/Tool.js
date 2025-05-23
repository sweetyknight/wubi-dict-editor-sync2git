const {shakeDom, shakeDomFocus, log, shuffle, logDictChange} = require('../../js/Utility')
const {IS_IN_DEVELOP, CONFIG_FILE_PATH} = require('../../js/Global')
const path = require('path')

const Dict = require('../../js/Dict')
const DictOther = require('../../js/DictOther')
const DictMap = require('../../js/DictMap')
const Word = require('../../js/Word')
const Vue  = require('../../node_modules/vue/dist/vue.common.prod')

const {ipcRenderer} = require('electron')
const VirtualScroller = require('vue-virtual-scroller')

// 监听主题变更事件
ipcRenderer.on('theme-changed', (event, theme) => {
    // 应用主题到当前页面
    document.documentElement.classList.remove('theme-dark', 'theme-auto', 'theme-white');
    document.body.classList.remove('theme-dark', 'theme-auto');
    
    if (theme === 'black') {
        document.documentElement.classList.add('theme-dark');
        document.body.classList.add('theme-dark');
    } else if (theme === 'auto') {
        document.documentElement.classList.add('theme-auto');
        document.body.classList.add('theme-auto');
    }
    
    // 保存到localStorage
    localStorage.setItem('wubi-theme', theme);
});


// Vue 2
const app = {
    el: '#app',
    components: {RecycleScroller: VirtualScroller.RecycleScroller},
    data() {
        return {
            IS_IN_DEVELOP: IS_IN_DEVELOP, // 是否为开发模式，html 使用

            tips: [], // 提示信息
            tipTimeoutHandler: null, // time out handler

            dict: {
                deep: true
            }, // 当前词库对象 Dict
            dictMain: {}, // 主码表 Dict
            keyword: '', // 搜索关键字
            code: '',
            word: '',
            activeGroupId: -1, // 组 index
            keywordUnwatch: null, // keyword watch 方法的撤消方法
            labelOfSaveBtn: '保存', // 保存按钮的文本
            heightContent: 0, // content 高度
            words: [], // 显示的 words

            chosenWordIds: new Set(),
            chosenWordIdArray: [], // 对应上面的 set 内容
            lastChosenWordIndex: null, // 最后一次选中的 index

            filePath: '', // 选择的文件路径
            fileName: '', // 选择的文件名


            targetDict: {}, // 要移动到的码表
            showDropdown: false, // 显示移动词条窗口
            dropdownFileList: [
                // {name: '拼音词库', path: 'pinyin_simp.dict.yaml'}
            ],
            dropdownActiveFileIndex: -1, // 选中的
            dropdownActiveGroupIndex: -1, // 选中的分组 ID

            config: {}, // 全局配置

            // 码表配置
            seperatorRead: '\t', // 分隔符
            seperatorSave: '\t', // 分隔符
            seperatorArray: [
                {name: '空格', value: ' ',},
                {name: 'Tab', value: '\t',}
            ], // 分隔符 数组
            dictFormatRead: 'wc', // 码表格式默认值
            dictFormatSave: 'wc', // 码表格式默认值
            dictFormatArray: [
                {name: '一码多词', value: 'cww',},
                {name: '一码一词', value: 'cw',},
                {name: '一词一码', value: 'wc',},
                {name: '纯词', value: 'w',},
                {name: 'Rime自造词码表', value: 'rime_auto',}
            ], // 码表格式数组
            filterCharacterLength: 0, // 筛选词条字数默认值
            filterCharacterLengthArray: [
                {name: '无', value: 0,},
                {name: '一', value: 1,},
                {name: '二', value: 2,},
                {name: '三', value: 3,},
                {name: '四', value: 4,},
                {name: '五+', value: 5,}
            ], // 筛选词条字数数组
            fileNameSave: '', // 显示的保存文件名
            dictMap: null, // main 返回的 dictMap，用于解码词条

            dictSetExceptCharacter: null, // 主码表，除了单字之外的所有词条 set

            wordEditing: null, // 正在编辑的词条
        }
    },
    mounted() {
        // 不再使用硬编码的文件路径
        // 在开发模式下如果需要测试，请使用全局配置中的设置

        this.heightContent = innerHeight - 47 - 20 - 10 + 3
        // 载入主要操作码表文件
        ipcRenderer.on('showFileContent', (event, fileName, filePath, fileContent) => {
            // 过滤移动到的文件列表，不显示正在显示的这个码表
            this.dropdownFileList = this.dropdownFileList.filter(item => item.path !== fileName)

            this.filePath = filePath
            this.fileName = fileName
            this.dict = new DictOther(fileContent, fileName, filePath, this.seperatorRead, this.dictFormatRead)
            this.fileNameSave = this.filePathSave()
            this.tips.push('载入完成')
            // 载入新码表时，清除 word 保存 code
            this.word = ''
            this.refreshShowingWords()
            // this.search() // 配置项：切换码表是否自动搜索
            ipcRenderer.send('ToolWindow:loadMainDict') // 请求主码表文件
        })
        ipcRenderer.on('saveFileSuccess', () => {
            this.labelOfSaveBtn = '保存成功'
            this.tips.push('保存成功')
            this.$refs.domBtnSave.classList.add('btn-green')
            setTimeout(()=>{
                this.$refs.domBtnSave.classList.remove('btn-green')
                this.labelOfSaveBtn = '保存'
            }, 2000)
        })

        // 由 window 触发获取文件目录的请求，不然无法实现适时的获取到 主进程返回的数据
        ipcRenderer.on('ToolWindow:FileList', (event, fileList) => {
            console.log(fileList)
            this.dropdownFileList = fileList
        })
        ipcRenderer.send('ToolWindow:GetFileList')

        // 载入目标码表
        ipcRenderer.on('ToolWindow:SetTargetDict', (event, filename, filePath, res) => {
            this.targetDict = new Dict(res, filename, filePath)
        })

        // 载入主码表
        ipcRenderer.on('ToolWindow:setMainDict', (event, filename, res) => {
            this.dictMain = new Dict(res, filename, '', true)
            console.log('dictMain载入完成，包含词条：',this.dictMain.dictSetExceptCharacter.size)
        })

        // 配置相关
        ipcRenderer.on('ToolWindow:ResponseConfigFile', (event, config) => {
            this.config = config
            console.log('窗口载入时获取到的 config 文件：', config)
        })
        ipcRenderer.send('ToolWindow:RequestConfigFile')

        // 配置文件保存后，向主窗口更新配置文件内容
        ipcRenderer.on('updateConfigFile', (event, config) => {
            this.config = config
        })

        // 获取并设置字典文件
        ipcRenderer.on('setDictMap', (event, fileContent, fileName, filePath) => {
            this.dictMap = new DictMap(null, fileContent)
        })
        ipcRenderer.send('getDictMap')

        this.addKeyboardListener()
        onresize = ()=>{
            this.heightContent = innerHeight - 47 - 20 - 10 + 3
        }
    },
    computed: {
        // 当前显示的 words 数量
        wordsCount(){
            if (this.dict.isGroupMode){
                let countCurrent = 0
                this.words.forEach(group => {
                    countCurrent = countCurrent + group.dict.length
                })
                return countCurrent
            } else {
                return this.words.length
            }
        },
        // 当前载入的是否为 主 码表
        isInMainDict(){
            return this.dict.fileName === 'wubi86_jidian.dict.yaml'
        }
    },

    methods: {
        tipNotice(){
            if (!this.tipTimeoutHandler && this.tips.length > 0){
                this.tipTimeoutHandler = setTimeout(()=>{
                    this.tips.shift()
                    clearTimeout(this.tipTimeoutHandler)
                    this.tipTimeoutHandler = null
                    this.tipNotice()
                }, 2000)
            }
        },
        // 确定编辑词条
        confirmEditWord(){
            // 记录编辑操作
            if (this.wordEditing) {
                logDictChange(this.dict.fileName, '编辑', this.wordEditing.word, this.wordEditing.code, 
                    this.wordEditing.priority, this.wordEditing.note);
            }
            this.wordEditing = null
        },
        // 生成编辑词条的编码
        generateCodeForWordEdit(){
            if (this.wordEditing){
                this.wordEditing.code = this.dictMap.decodeWord(this.wordEditing.word)
            } else {
                shakeDomFocus(this.$refs.editInputWord)
            }
        },
        // 编辑词条
        editWord(word){
            this.wordEditing = word
        },

        generateCodeForAllWords(){
            this.dict.wordsOrigin.forEach(word => {
                console.log(word)
                word.setCode(this.dictMap.decodeWord(word.word))
            })
            console.log(this.dictMap)
            this.refreshShowingWords()
            this.tips.push('编码生成完成')
        },
        // 生成保存文件的文件名
        filePathSave(withFullPath){
            let filePathObject = path.parse(this.filePath)
            let type = ''
            switch (this.dictFormatSave){
                case 'cww': type = '一码多词';break;
                case 'wc': type = '一词一码';break;
                case 'cw': type = '一码一词';break;
                case 'w': type = '纯词';break;
                case 'rime_auto': type = 'Rime格式';break;
            }
            let seperater = ''
            switch (this.seperatorSave){
                case ' ': seperater = '空格分隔';break;
                case '\t': seperater = 'Tab分隔';break;
            }
            if (withFullPath){
                return path.join(
                    filePathObject.dir,
                    filePathObject.name + '_' + type + '_' + seperater + filePathObject.ext
                )
            } else {
                return filePathObject.name + '_' + type + '_' + seperater + filePathObject.ext
            }
        },

        // 根据码表的一些参数，重新载入当前文件
        reloadCurrentFile(){
            ipcRenderer.send('ToolWindow:loadFileContent', this.filePath)
        },
        // 筛选词条字数
        changeFilterWordLength(length){
            this.filterCharacterLength = parseInt(length)
            this.words = this.dict.getWordsLengthOf(length)
        },

        // 查重
        checkRepetition(includeCharacter, isWithAllRepeatWord){
            this.words = this.dict.getRepetitionWords(includeCharacter, isWithAllRepeatWord)
        },

        // 去除权重为 0 的词条
        removePriority0(){
            this.dict.wordsOrigin = this.dict.wordsOrigin.filter(item => item.priority !== '0')
            this.words = this.dict.wordsOrigin
        },

        // 去除主表已存在的词条
        removeWordsAlreadyInMainDict(){
            this.dict.wordsOrigin = this.dict.wordsOrigin.filter(item => !this.dictMain.dictSetExceptCharacter.has(item.word))
            this.words = this.dict.wordsOrigin
        },

        // 载入码表文件
        loadDictFile(){
            ipcRenderer.send('ToolWindow:chooseDictFile')
        },
        select(index, wordId, event){
            if (event.shiftKey){
                if (this.lastChosenWordIndex !== null){
                    let a,b // 判断大小，调整大小顺序
                    if (index > this.lastChosenWordIndex){
                        a = this.lastChosenWordIndex
                        b = index
                    } else {
                        b = this.lastChosenWordIndex
                        a = index
                    }
                    for (let i=a; i<=b; i++){
                        this.chosenWordIds.add(this.words[i].id)
                    }
                }
                this.lastChosenWordIndex = null // shift 选择后，最后一个id定义为没有

            } else {
                if (this.chosenWordIds.has(wordId)){
                    this.chosenWordIds.delete(wordId)
                    this.lastChosenWordIndex = null
                } else {
                    this.chosenWordIds.add(wordId)
                    this.lastChosenWordIndex = index
                }
            }
            this.chosenWordIdArray = [...this.chosenWordIds.values()]
        },
        // 选择移动到的分组 index
        setDropdownActiveGroupIndex(index){
            this.dropdownActiveGroupIndex = index
        },
        // 选择移动到的文件 index
        setDropdownActiveIndex(fileIndex){
            this.dropdownActiveFileIndex = fileIndex
            this.dropdownActiveGroupIndex = -1 // 切换文件列表时，复位分组 fileIndex
            // this.dictSecond = {} // 立即清空次码表，分组列表也会立即消失，不会等下面的码表加载完成再清空
            ipcRenderer.send('ToolWindow:LoadTargetDict', this.dropdownFileList[fileIndex].path) // 载入当前 index 的文件内容
        },
        sort(){
            let startPoint = new Date().getTime()
            this.words.sort((a,b) => a.code < b.code ? -1: 1)
            this.tips.push('排序完成')
            console.log(`排序用时 ${new Date().getTime() - startPoint} ms`)
        },

        // 全文乱序
        shuffleAll(){
            this.words = shuffle(this.words)
            // 只是为了让其响应数组数据的变化
            this.words.push(new Word(19910123, 'gutu', '邴新科', 999, '临时词条'))
            this.words.pop()
        },

        enterKeyPressed(){
            switch (this.config.enterKeyBehavior){
                case "add":this.addNewWord(); break;
                case "search": this.search(); break;
                default: break;
            }
        },

        // 通过 code, word 筛选词条
        search(){
            this.chosenWordIds.clear()
            this.chosenWordIdArray = []
            this.activeGroupId = -1 // 切到【全部】标签页，展示所有搜索结果
            let startPoint = new Date().getTime()
            if (this.code || this.word){
                this.words = this.dict.wordsOrigin.filter(item => { // 获取包含 code 的记录
                    switch (this.config.searchMethod){
                        case "code": return item.code.includes(this.code);
                        case "phrase": return item.word.includes(this.word);
                        case "both": return item.code.includes(this.code) && item.word.includes(this.word)
                        case "any": return item.code.includes(this.code) || item.word.includes(this.word)
                    }
                })
                console.log(`${this.code} ${this.word}: ` ,'搜索出', this.words.length, '条，', '用时: ', new Date().getTime() - startPoint, 'ms')
            } else { // 如果 code, word 为空，恢复原有数据
                this.refreshShowingWords()
            }
        },

        // 刷新 this.words
        refreshShowingWords(){
            this.chosenWordIds.clear()
            this.chosenWordIdArray = []
            this.words = [...this.dict.wordsOrigin]
        },
        addNewWord(){
            if (!this.word){
                shakeDomFocus(this.$refs.domInputWord)
            } else if (!this.code){
                shakeDomFocus(this.$refs.domInputCode)
            } else {
                // 创建新词条
                const newWord = new Word(this.dict.lastIndex++, this.code, this.word);
                this.dict.addWordToDictInOrder(newWord);
                // 记录添加操作
                logDictChange(this.dict.fileName, '添加', this.word, this.code, '', '');
                this.refreshShowingWords();
                console.log(this.code, this.word);
            }
        },
        // 保存内容到文件
        saveToFile(dict, isSaveToOriginalFilePath){
            if (this.dict.lastIndex >= 1){ // 以 dict 的 lastIndex 作为判断有没有加载码表的依据
                if (isSaveToOriginalFilePath){ // 保存到原来文件，针对工具里打开的文件，和词条移动的目标文件
                    console.log('保存文件路径： ', dict.filePath)
                    ipcRenderer.send(
                        'ToolWindow:SaveFile',
                        dict.filePath,
                        dict.toYamlString())
                } else { // 保存成新文件，新文件名，只针对工具里打开的码表
                    console.log('保存文件路径： ', this.filePathSave(true))
                    ipcRenderer.send(
                        'ToolWindow:SaveFile',
                        this.filePathSave(true),
                        this.dict.toExportString(this.seperatorSave, this.dictFormatSave))
                }
            } else {
                console.log('未加载任何码表文件')
            }
        },
        // 选中全部展示的词条
        selectAll(){
            if(this.wordsCount < 100000){ // 最多同时选择 10w 条数据
                if (this.dict.isGroupMode){
                    this.chosenWordIds.clear()
                    this.chosenWordIdArray = []
                    this.words.forEach(group => {
                        group.forEach( item => {
                            this.chosenWordIds.add(item.id)
                        })
                    })
                } else {
                    this.words.forEach(item => {this.chosenWordIds.add(item.id)})
                }
                this.chosenWordIdArray = [...this.chosenWordIds.values()]
            } else {
                // 提示不能同时选择太多内容
                this.tips.push('不能同时选择大于 1000条 的词条内容')
                shakeDom(this.$refs.domBtnSelectAll)
            }
        },
        // 清除内容
        resetInputs(){
            this.chosenWordIds.clear()
            this.chosenWordIdArray = []
            this.code = ''
            this.word = ''
            this.search()
            this.tips = []
        },
        // 删除词条：单
        deleteWord(wordId){
            // 在删除前查找词条以便记录日志
            let wordToDelete = null;
            if (this.dict.isGroupMode) {
                // 在分组模式下查找词条
                for (const group of this.dict.wordsOrigin) {
                    wordToDelete = group.dict.find(item => item.id === wordId);
                    if (wordToDelete) break;
                }
            } else {
                // 非分组模式下查找词条
                wordToDelete = this.dict.wordsOrigin.find(item => item.id === wordId);
            }
            
            this.chosenWordIds.delete(wordId);
            this.chosenWordIdArray = [...this.chosenWordIds.values()];
            this.dict.deleteWords(new Set([wordId]));
            
            // 记录删除操作
            if (wordToDelete) {
                logDictChange(this.dict.fileName, '删除', wordToDelete.word, wordToDelete.code, 
                    wordToDelete.priority, wordToDelete.note);
            }
            
            this.refreshShowingWords();
        },
        // 删除词条：多
        deleteWords(){
            // 在删除前获取词条信息以便记录日志
            const wordsToDelete = [];
            if (this.dict.isGroupMode) {
                // 分组模式下查找词条
                for (const group of this.dict.wordsOrigin) {
                    for (const word of group.dict) {
                        if (this.chosenWordIds.has(word.id)) {
                            wordsToDelete.push(word);
                        }
                    }
                }
            } else {
                // 非分组模式下查找词条
                for (const word of this.dict.wordsOrigin) {
                    if (this.chosenWordIds.has(word.id)) {
                        wordsToDelete.push(word);
                    }
                }
            }
            
            this.dict.deleteWords(this.chosenWordIds);
            
            // 记录批量删除操作
            for (const word of wordsToDelete) {
                logDictChange(this.dict.fileName, '删除', word.word, word.code, 
                    word.priority, word.note);
            }
            
            this.refreshShowingWords();
            this.chosenWordIds.clear(); // 清空选中 wordID
            this.chosenWordIdArray = [];
        },

        // 词条位置移动
        move(wordId, direction){
            if (this.dict.isGroupMode){
                // group 时，移动 调换 word 位置，是直接调动的 wordsOrigin 中的word
                // 因为 group 时数据为： [{word, word},{word,word}]，是 wordGroup 的索引
                for(let i=0; i<this.words.length; i++){
                    let group = this.words[i]
                    for(let j=0; j<group.dict.length; j++){
                        if (wordId === group.dict[j].id){
                            let tempItem = group.dict[j]
                            if (direction === 'up'){
                                if (j !==0){
                                    group.dict[j] = group.dict[j - 1]
                                    group.dict[j - 1] = tempItem
                                    return ''
                                } else {
                                    console.log('已到顶')
                                    return '已到顶'
                                }
                            } else if (direction === 'down'){
                                if (j+1 !== group.dict.length){
                                    group.dict[j] = group.dict[j + 1]
                                    group.dict[j + 1] = tempItem
                                    return ''
                                } else {
                                    console.log('已到底')
                                    return '已到底'
                                }
                            }
                        }
                    }
                }
            } else {
                // 非分组模式时，调换位置并不能直接改变 wordsOrigin 因为 与 words 已经断开连接
                // [word, word]
                for(let i=0; i<this.words.length; i++){
                    if (wordId === this.words[i].id){
                        let tempItem = this.words[i]
                        if (direction === 'up'){
                            if (i !==0) {
                                this.dict.exchangePositionInOrigin(tempItem, this.words[i-1]) // 调换 wordsOrigin 中的词条位置
                                this.words[i] = this.words[i - 1]
                                this.words[i - 1] = tempItem
                                return ''
                            } else {
                                console.log('已到顶')
                                return '已到顶'
                            }
                        } else if (direction === 'down'){
                            if (i+1 !== this.words.length) {
                                this.dict.exchangePositionInOrigin(tempItem, this.words[i+1]) // 调换 wordsOrigin 中的词条位置
                                this.words[i] = this.words[i + 1]
                                this.words[i + 1] = tempItem
                                return ''
                            } else {
                                console.log('已到底')
                                return '已到底'
                            }
                        }
                    }
                }
            }
        },

        // 上移词条
        moveUp(id){
            this.tips.push(this.move(id, 'up'))
            let temp = this.words.pop()
            this.words.push(temp)
        },
        // 下移词条
        moveDown(id){
            this.tips.push(this.move(id, 'down'))
            let temp = this.words.pop()
            this.words.push(temp)
        },
        // 判断是否为第一个元素
        isFirstItem(id){
            if (this.dict.isGroupMode){ // 分组时的第一个元素
                for (let i=0; i<this.words.length; i++) {
                    for (let j = 0; j < this.words[i].dict.length; j++) {
                        if (this.words[i].dict[j].id === id){
                            return j === 0 // 使用 array.forEach() 无法跳出循环
                        }
                    }
                }
                return false
            } else {
                for (let i = 0; i < this.words.length; i++) {
                    if (this.words[i].id === id){
                        return i === 0 // 使用 array.forEach() 无法跳出循环
                    }
                }
                return false
            }
        },
        // 判断是否为最后一个元素
        isLastItem(id){
            if (this.dict.isGroupMode){ // 分组时的最后一个元素
                for (let i=0; i<this.words.length; i++) {
                    for (let j = 0; j < this.words[i].dict.length; j++) {
                        if (this.words[i].id === id){
                            return j + 1 === this.words.length
                        }
                    }
                }
                return false
            } else {
                for (let i = 0; i < this.words.length; i++) {
                    if (this.words[i].id === id){
                        return i + 1 === this.words.length
                    }
                }
                return false
            }
        },
        // 绑定键盘事件： 键盘上下控制词条上下移动
        addKeyboardListener(){
            window.addEventListener('keydown', event => {
                // console.log(event)
                switch( event.key) {
                    case 's':
                        if (event.ctrlKey || event.metaKey){ // metaKey 是 macOS 的 Ctrl
                            this.saveToFile(this.dict)
                            event.preventDefault()
                        } else {

                        }
                        break
                    case 'ArrowDown':
                        if(this.chosenWordIds.size === 1) { // 只有一个元素时，键盘才起作用
                            let id = [...this.chosenWordIds.values()][0]
                            this.moveDown(id)
                        }
                        event.preventDefault()
                        break
                    case 'ArrowUp':
                        if(this.chosenWordIds.size === 1) { // 只有一个元素时，键盘才起作用
                            let id = [...this.chosenWordIds.values()][0]
                            this.moveUp(id)
                        }
                        event.preventDefault()
                        break
                }
            })
        },
        // 将选中的词条移动到指定码表
        moveWordsToTargetDict(){
            let wordsTransferring = this.dict.wordsOrigin.filter(item => this.chosenWordIds.has(item.id)) // 被转移的 [Word]
            console.log('words transferring：', JSON.stringify(wordsTransferring))

            this.targetDict.addWordsInOrder(wordsTransferring, this.dropdownActiveGroupIndex)

            this.words = [...this.dict.wordsOrigin]
            console.log('after insert:( main:wordOrigin ):\n ', JSON.stringify(this.targetDict.wordsOrigin))

            this.deleteWords() // 删除当前词库已移动的词条
            this.saveToFile(this.targetDict, true)
            this.saveToFile(this.dict, true)
            this.tips.push('移动成功')
            this.resetDropList()
        },
        // 复制 dropdown
        resetDropList(){
            this.showDropdown = false
            this.dropdownActiveFileIndex = -1
            this.dropdownActiveGroupIndex = -1
            this.targetDict = {} // 清空次码表
        },
        // 打开当前码表源文件
        openCurrentYaml(){
            ipcRenderer.send('openFileOutside', this.dict.fileName)
        },

        // 导出选中词条到 plist 文件
        exportSelectionToPlist(){
            let wordsSelected = [] // 被选中的 [Word]
            if (this.dict && this.dict.wordsOrigin.length > 0){
                wordsSelected = this.dict.wordsOrigin.filter(item => this.chosenWordIds.has(item.id))
                ipcRenderer.send('ToolWindow:ExportSelectionToPlistFile', wordsSelected)
            } else {
                this.tips.push('没有任何词条')
            }
        },
    },
    watch: {
        tips(){
            this.tipNotice()
        },
        code(newValue){
            this.code = newValue.replaceAll(/[^A-Za-z ]/g, '') // input.code 只允许输入字母
        },
        word(newValue, oldValue){
            if (newValue.length < oldValue.length){
                // 删除或清空时，不清空编码
            } else {
                if (this.dictMap){
                    this.code = this.dictMap.decodeWord(newValue)
                }
            }
        },
        seperatorSave(){
            this.fileNameSave = this.filePathSave()
        },
        dictFormatSave(){
            this.fileNameSave = this.filePathSave()
        },
        chosenWordIdArray(newValue){
            if (newValue.length === 0){
                this.showDropdown = false
            }
            console.log('已选词条id: ', JSON.stringify(newValue))
        },
        showDropdown(newValue){
            if (!newValue){ // 窗口关闭时，重置 index
                this.resetDropList()
            }
        },
        config: (newValue) => {
            switch (newValue.theme){
                case "auto":
                    document.documentElement.classList.add('auto-mode');
                    document.documentElement.classList.remove('dark-mode');
                    break;
                case "black":
                    document.documentElement.classList.add('dark-mode');
                    document.documentElement.classList.remove('auto-mode');
                    break;
            }
        }
    },
}

new Vue(app)
