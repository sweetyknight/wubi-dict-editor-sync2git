const {shakeDom, shakeDomFocus, log, dateFormatter, getUnicodeStringLength, logDictChange} = require('../../js/Utility')
const {IS_IN_DEVELOP, BASE_URL, CONFIG_FILE_PATH} = require('../../js/Global')

const Dict = require('../../js/Dict')
const DictMap = require('../../js/DictMap')
const Word = require('../../js/Word')
const Vue  = require('../../node_modules/vue/dist/vue.common.prod')

// 导入Electron的API，用于与主进程进行通信
const {ipcRenderer, net} = require('electron') // ipcRenderer用于与主进程通信，net用于网络请求
const VirtualScroller = require('vue-virtual-scroller')
const WordGroup = require("../../js/WordGroup");


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
    el: '#app', // 设置应用挂载的HTML元素ID
    components: {RecycleScroller: VirtualScroller.RecycleScroller},
    data() {
        return {
            IS_IN_DEVELOP, // 是否为开发模式，html 使用

            tips: [], // 用于存放向用户显示的提示消息
            tipTimeoutHandler: null, // time out handler

            dict: {},  // 当前词库对象 Dict
            dictMain: {}, // 主码表 Dict
            keyword: '', // 搜索关键字

            code: '', // 词条编码
            word: '', // 词条内容
            priority: '', // 词条优先级
            note: '', // 词条备注

            wordsRedundancy: [],  // 存放重复的词条（那些有相同编码的词条）
            isSearchbarFocused: false, // 搜索栏是否被聚焦

            activeGroupId: -1, // 当前激活的组的索引
            keywordUnwatch: null, // keyword watch 方法的撤消方法
            labelOfSaveBtn: '保存', // 保存按钮的文本
            heightContent: 0, // content 高度
            words: [], // 显示的词条列表

            chosenWordIds: new Set(), // 被选中的词条ID的集合
            chosenWordIdArray: [], // 对应上面的 set 内容
            lastChosenWordIndex: null, // 最后一次选中的词条的 index


            targetDict: {}, // 要移动到的码表
            isShowDropdown: false, // 是否显示下拉菜单
            dropdownFileList: [
                // 存放文件的列表，示例：{name: '拼音词库', path: 'pinyin_simp.dict.yaml'}
            ],
            dropdownActiveFileIndex: -1, // 当前选中的文件索引
            dropdownActiveGroupIndex: -1, // 当前选中的分组索引

            config: {}, // 全局配置

            dictMap: null, // main 返回的 dictMap，用于解码词条

            wordEditing: null, // 正在编辑的词条

            // 新增这两个变量
            isDeleteAfterUpload: false,
            dictBackupInfo: null,

            // 网络相关
            categories: [],  // 词库分类列表
            selectedCategoryId: 10, // 默认选中的分类ID（通用词库）

            showDialog: false, // 控制弹窗显示
            dialogMsg: '',     // 弹窗内容
        }
    },
    mounted() {
        // 为了消除奇怪的界面高度显示问题
        setTimeout(()=> {
            this.heightContent = innerHeight - 47 - 20 - 10 + 3 // 动态计算内容区域的高度
        }, 300)

        // 窗口显示时 WINDOWS SHOWED
        ipcRenderer.on('MainWindow:onWindowShowed', (event) => {
            this.$refs.domInputWord.focus()
        })
        // 载入主要操作码表文件
        ipcRenderer.on('showFileContent', (event, fileName, filePath, res) => {
            // 载入新字典时，清空搜索框和词条编码
            // this.dropdownFileList = this.dropdownFileList.filter(item => item.path !== fileName)
            this.dict = new Dict(res, fileName, filePath)
            // 载入新码表时，清除 word 保存 code
            this.word = ''
            this.refreshShowingWords()
            // this.search() // 配置项：切换码表是否自动搜索
            ipcRenderer.send('loadMainDict') // 请求主码表文件
            ipcRenderer.send('getDictMap')   // 确保dictMap也被请求加载
            this.tips.push('已载入码表')
        })

        // 监听保存成功的事件
        ipcRenderer.on('saveFileSuccess', () => {
            this.labelOfSaveBtn = '保存成功'
            this.$refs.domBtnSave.classList.add('btn-green') // 设置按钮的样式为绿色
            setTimeout(()=>{
                this.$refs.domBtnSave.classList.remove('btn-green')
                this.labelOfSaveBtn = '保存'
            }, 2000)
        })

        // 配置相关
        // 载入配置文件后处理
        ipcRenderer.on('MainWindow:ResponseConfigFile', (event, config) => {
            this.config = config  // 更新配置
            this.activeGroupId = config.chosenGroupIndex // 设置激活的分组。首次载入时，定位到上次选中的分组
            console.log('窗口载入时获取到的 config 文件：', config)

            // request for file list
            ipcRenderer.send('GetFileList')
        })
        ipcRenderer.send('MainWindow:RequestConfigFile')        // 监听获取的文件列表
        // 由 window 触发获取文件目录的请求，不然无法实现适时的获取到 主进程返回的数据
        ipcRenderer.on('FileList', (event, fileList) => {
            // 此时已经存在  config 了
            // 更新文件列表，同时保留配置中的外部文件
            if (this.config.fileNameList && this.config.fileNameList.length > 0){
                // 创建文件路径到名称的映射
                let fileNameMap = new Map()
                this.config.fileNameList.forEach(fileNamePair => {
                    fileNameMap.set(fileNamePair.path, fileNamePair.name)
                })
                
                // 创建一个合并列表，包含fileList和配置中的文件（去重）
                let mergedFiles = [...fileList]
                
                // 添加配置中存在但不在fileList中的文件（外部文件）
                this.config.fileNameList.forEach(configFile => {
                    const exists = mergedFiles.some(file => file.path === configFile.path)
                    if (!exists) {
                        mergedFiles.push({
                            name: configFile.name,
                            path: configFile.path
                        })
                    }
                })
                
                // 使用映射中的自定义名称，如果有的话
                this.dropdownFileList = mergedFiles.map(fileItem => {
                    return {
                        name: fileNameMap.get(fileItem.path) || fileItem.name,
                        path: fileItem.path
                    }
                }).sort((a,b) => a.name > b.name ? 1:-1)
            } else {
                this.dropdownFileList = fileList
            }
        })
        // 初始化码表文件
        ipcRenderer.send('loadInitDictFile')

        // 载入目标码表
        ipcRenderer.on('setTargetDict', (event, fileName, filePath, res) => {
            this.targetDict = new Dict(res, fileName, filePath)
        })

        // 载入主码表
        ipcRenderer.on('setMainDict', (event, filename, res) => {
            this.dictMain = new Dict(res, filename, '', true)
            console.log('主码表词条数量：', this.dictMain.wordsOrigin.length)
        })

        // 配置文件更新后同步到主窗口
        ipcRenderer.on('updateConfigFile', (event, config) => {
            this.config = config
        })



        // 获取并设置字典文件
        ipcRenderer.on('setDictMap', (event, fileContent, fileName, filePath) => {
            this.dictMap = new DictMap(null, fileContent)
        })        // 监听上传/下载 Git 操作结果
        ipcRenderer.on('gitOperationResult', (event, msg) => {
            this.dialogMsg = msg
            this.showDialog = true
            // 移除自动关闭弹窗的定时器，改为由用户点击关闭
        })

        // 监听错误对话框请求
        ipcRenderer.on('showErrorDialog', (event, errorMsg) => {
            this.dialogMsg = errorMsg
            this.showDialog = true
            // 提供确认按钮
            this.$nextTick(() => {
                // 动态插入按钮
                let dialog = document.querySelector('.custom-dialog-footer') || document.body
                dialog.innerHTML = '' // 清空原有内容
                let btns = document.createElement('div')
                btns.style = 'display:flex;justify-content:center;'
                btns.innerHTML = `<button id="btn-confirm-error" class="btn btn-primary">确定</button>`
                dialog.appendChild(btns)
                document.getElementById('btn-confirm-error').onclick = () => {
                    ipcRenderer.send('confirmCreateRemoteFolderResult', true) // 复用现有通道
                    this.showDialog = false
                }
            })
        })

        // 监听远程文件夹创建确认请求
        ipcRenderer.on('confirmCreateRemoteFolder', (event, folder) => {
            this.dialogMsg = `远程文件夹 "${folder}" 不存在，是否创建？`
            this.showDialog = true
            // 提供确认/取消按钮
            this.$nextTick(() => {
                // 动态插入按钮
                let dialog = document.querySelector('.custom-dialog-footer') || document.body;
                dialog.innerHTML = ''; // 清空原有内容
                let btns = document.createElement('div');
                btns.style = 'display:flex;justify-content:center;gap:18px;';
                btns.innerHTML = `<button id="btn-confirm-create-folder" class="btn btn-primary">确认创建</button><button id="btn-cancel-create-folder" class="btn btn-orange">取消</button>`;
                dialog.appendChild(btns);
                document.getElementById('btn-confirm-create-folder').onclick = () => {
                    ipcRenderer.send('confirmCreateRemoteFolderResult', true);
                    this.showDialog = false;
                };
                document.getElementById('btn-cancel-create-folder').onclick = () => {
                    ipcRenderer.send('confirmCreateRemoteFolderResult', false);
                    this.showDialog = false;
                };
            });
        })
        
        // 监听错误对话框请求
        ipcRenderer.on('showErrorDialog', (event, errorMsg) => {
            this.dialogMsg = errorMsg;
            this.showDialog = true;
            // 提供确认按钮
            this.$nextTick(() => {
                // 动态插入按钮
                let dialog = document.querySelector('.custom-dialog-footer') || document.body;
                dialog.innerHTML = ''; // 清空原有内容
                let btns = document.createElement('div');
                btns.style = 'display:flex;justify-content:center;';
                btns.innerHTML = `<button id="btn-confirm-error" class="btn btn-primary">确定</button>`;
                dialog.appendChild(btns);
                document.getElementById('btn-confirm-error').onclick = () => {
                    ipcRenderer.send('confirmCreateRemoteFolderResult', true); // 复用现有通道
                    this.showDialog = false;
                };
            });
        })

        // 监听 config.html 词典文件变更事件
        ipcRenderer.on('ConfigWindow:DictFilesChanged', () => {
            ipcRenderer.send('MainWindow:RequestConfigFile'); // 重新请求配置
            ipcRenderer.send('GetFileList'); // 重新请求文件列表
        });

        this.addKeyboardListener()
        onresize = ()=>{
            this.heightContent = innerHeight - 47 - 20 - 10 + 3
        }
    },
    // 计算属性：显示的词条数量
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
        },
        // 文件名字列表
        fileNameListMap(){
            // [{ "name": "luna_pinyin.sogou", "path": "luna_pinyin.sogou.dict.yaml" }]
            return new Map(this.config.fileNameList.map(item => [item.path, item.name]))
        }
    },
    // 方法：各种操作，如显示/隐藏文件列表、上传、下载等
    methods: {
        // 显示 | 隐藏 移动到文件的列表
        toggleFileListDropDown(){
            if (this.isShowDropdown){
                this.isShowDropdown = false
            } else {
                // 匹配跟当前码表一致的 file Index，只在分组模式时自动选择
                if (this.dict.isGroupMode){
                    this.dropdownFileList.forEach((item, index) => {
                        if (item.path === this.dict.fileName){
                            this.dropdownActiveFileIndex = index
                            this.setDropdownActiveIndex(index)
                        }
                    })
                }
                this.isShowDropdown = true
            }
        },


        // 部署码表内容
        applyRime(){
            ipcRenderer.send('MainWindow:ApplyRime')
        },
        // 工具面板展开
        toolPanelExpand(){
            this.config.isToolPanelShowing = true
            ipcRenderer.send('saveConfigFileFromMainWindow', JSON.stringify(this.config))
        },
        // 工具面板关闭
        toolPanelClose(){
            this.config.isToolPanelShowing = false
            ipcRenderer.send('saveConfigFileFromMainWindow', JSON.stringify(this.config))
        },
        // 切换码表文件
        switchToFile(file){
            ipcRenderer.send('MainWindow:LoadFile', file.path)
        },

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
            // 只有当前选中的词典才允许写入
            if (!this.dict || !this.dict.fileName || this.dict.fileName !== this.dict.fileName) {
                this.tips.push('请先选择要操作的词典文件')
                this.wordEditing = null
                return
            }
            
            // 记录编辑操作
            if (this.wordEditing) {
                logDictChange(this.dict.fileName, '编辑', this.wordEditing.word, this.wordEditing.code, 
                    this.wordEditing.priority, this.wordEditing.note);
            }
            
            this.wordEditing = null
            if(this.config.autoDeployOnEdit){
                this.saveToFile(this.dict)
            }
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

        // 选择操作
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

                    if (this.dict.isGroupMode){
                        // TODO: select batch words cross group
                        if (this.activeGroupId !== -1){
                            for (let i=a; i<=b; i++){
                                this.chosenWordIds.add(this.dict.wordsOrigin[this.activeGroupId].dict[i].id)
                            }
                        } else {
                            this.tips.push('只能在单组内进行批量选择')
                        }
                    } else {
                        for (let i=a; i<=b; i++){
                            this.chosenWordIds.add(this.words[i].id)
                        }
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
            ipcRenderer.send('MainWindow:LoadSecondDict', this.dropdownFileList[fileIndex].path) // 载入当前 index 的文件内容
        },
        addPriority(){
            this.dict.addCommonPriority()
        },
        generateSqlFile(){
            let sqlArray = this.dict.wordsOrigin.map(word => {
                let timeNow = dateFormatter(new Date())
                return `INSERT into wubi_words(word, code, priority, date_create, comment, user_init, user_modify, category_id)
                    VALUES(
                        '${word.word}','${word.code}',${word.priority || 0},'${timeNow}','${word.note}', 3, 3, 1);`
            })
            ipcRenderer.send('saveFile', 'sql.sql', sqlArray.join('\n'))
        },
        sort(){
            // 只有当前选中的词典才允许写入
            if (!this.dict || !this.dict.fileName || this.dict.fileName !== this.dict.fileName) {
                this.tips.push('请先选择要操作的词典文件')
                return
            }
            this.dict.sort(this.activeGroupId)
            this.refreshShowingWords()
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
                if (this.dict.isGroupMode){
                    this.words = []
                    this.dict.wordsOrigin.forEach(groupItem => {
                        let tempGroupItem = groupItem.clone() // 不能直接使用原 groupItem，不然会改变 wordsOrigin 的数据
                        tempGroupItem.dict = tempGroupItem.dict.filter(item => {
                            switch (this.config.searchMethod){
                                case "code": return item.code.includes(this.code);
                                case "phrase": return item.word.includes(this.word);
                                case "both": return item.code.includes(this.code) && item.word.includes(this.word)
                                case "any": return item.code.includes(this.code) || item.word.includes(this.word)
                            }
                        })
                        if (tempGroupItem.dict.length > 0){ // 当前分组中有元素，添加到结果中
                            this.words.push(tempGroupItem)
                        }
                    })
                    console.log('用时: ', new Date().getTime() - startPoint, 'ms')
                } else {
                    this.words = this.dict.wordsOrigin.filter(item => { // 获取包含 code 的记录
                        switch (this.config.searchMethod){
                            case "code": return item.code.includes(this.code);
                            case "phrase": return item.word.includes(this.word);
                            case "both": return item.code.includes(this.code) && item.word.includes(this.word)
                            case "any": return item.code.includes(this.code) || item.word.includes(this.word)
                        }
                    })
                    console.log(`${this.code} ${this.word}: ` ,'搜索出', this.words.length, '条，', '用时: ', new Date().getTime() - startPoint, 'ms')
                }

            } else { // 如果 code, word 为空，恢复原有数据
                this.refreshShowingWords()
            }
        },

        // 查重
        checkRepetition(includeCharacter, isWithAllRepeatWord, isWithAllType){
            this.setGroupId(-1) // 高亮分组定位到 【全部】
            this.words = this.dict.getRepetitionWords(includeCharacter, isWithAllRepeatWord, isWithAllType)
        },

        // 查询所有与单字重复的词条
        checkRepeatedWordWithSameCode(){
            this.words = this.dict.getRepeatedWordsWithSameCode()
        },

        // 词组编码查错
        getErrorWords(){
            let errorWords = []
            if (!this.dictMap) {
                this.tips.push('未加载主码表，无法查错')
                return
            }
            if(this.dict.isGroupMode){
                // 分组模式时
                this.dict.wordsOrigin.forEach(wordGroup => {
                    wordGroup.dict.forEach(item => {
                        item.indicator = wordGroup.groupName
                        if (getUnicodeStringLength(item.word) > 1 && !/[a-zA-Z0-9]+/.test(item.word)) { // 只判断词条，不判断单字
                            if (item.code !== this.dictMap.decodeWord(item.word)) {
                                errorWords.push(item)
                            }
                        }
                    })
                })
            } else {
                // 非分组模式时
                this.dict.wordsOrigin.forEach(item => {
                    if (getUnicodeStringLength(item.word) > 1 && !/[a-zA-Z0-9]+/.test(item.word)) { // 只判断词条，不判断单字
                        if (item.code !== this.dictMap.decodeWord(item.word)) {
                            errorWords.push(item)
                        }
                    }
                })
            }
            let errorWordOrigin = []
            if (this.dict.isGroupMode){
                // 当是分组模式时，返回一个新的分组，不然无法显示正常
                errorWordOrigin.push(new WordGroup(888, '编码可能错误的词条', errorWords))
            } else {
                errorWordOrigin = errorWords
            }
            this.words = errorWordOrigin
        },


        // 单字编码查错
        getErrorWordsSingle(){
            let errorWords = []
            if(this.dict.isGroupMode){
                // 分组模式时
                this.dict.wordsOrigin.forEach(wordGroup => {
                    wordGroup.dict.forEach(item => {
                        item.indicator = wordGroup.groupName
                        if (getUnicodeStringLength(item.word) === 1) {
                            if (item.code !== this.dictMap.decodeWordSingle(`${item.word}-${item.code.length}`)) {
                                errorWords.push(item)
                            }
                        }
                    })
                })
            } else {
                // 非分组模式时
                this.dict.wordsOrigin.forEach(item => {
                    if (getUnicodeStringLength(item.word) === 1) {
                        if (item.code !== this.dictMap.decodeWordSingle(`${item.word}-${item.code.length}`)) {
                            errorWords.push(item)
                        }
                    }
                })
            }
            let errorWordOrigin = []
            if (this.dict.isGroupMode){
                // 当是分组模式时，返回一个新的分组，不然无法显示正常
                errorWordOrigin.push(new WordGroup(888, '编码可能错误的词条', errorWords))
            } else {
                errorWordOrigin = errorWords
            }
            this.words = errorWordOrigin
        },


        // 选中词条纠错
        correctErrorWords(){
            // 只有当前选中的词典才允许写入
            if (!this.dict || !this.dict.fileName || this.dict.fileName !== this.dict.fileName) {
                this.tips.push('请先选择要操作的词典文件')
                return
            }

            let timeStart = new Date().getTime()
            let correctionCount = 0
            let errorCount = 0
            this.chosenWordIds.forEach(id => {
                if (this.dict.isGroupMode){
                    // 分组模式时
                    this.words.forEach(wordGroup => {
                        wordGroup.dict.forEach(item => {
                            if (item.id === id){
                                if (getUnicodeStringLength(item.word) === 1){ // 单字时
                                    let correctCode = this.dictMap.decodeWordSingle(`${item.word}-${item.code.length}`)
                                    if (correctCode){
                                        item.setCode(correctCode)
                                        correctionCount = correctionCount + 1
                                    } else {
                                        item.setCode('orz')
                                        errorCount = errorCount + 1
                                    }
                                } else {
                                    let correctCode = this.dictMap.decodeWord(item.word)
                                    if (correctCode){
                                        item.setCode(correctCode)
                                        correctionCount = correctionCount + 1
                                    }
                                }
                            }
                        })
                    })
                } else {
                    // 非分组模式时
                    this.words.forEach(item => {
                        if (item.id === id){
                            if (getUnicodeStringLength(item.word) === 1){ // 单字时
                                let correctCode = this.dictMap.decodeWordSingle(`${item.word}-${item.code.length}`)
                                if (correctCode){
                                    item.setCode(correctCode)
                                    correctionCount = correctionCount + 1
                                } else {
                                    item.setCode('orz')
                                    errorCount = errorCount + 1
                                }
                            } else {
                                let correctCode = this.dictMap.decodeWord(item.word)
                                if (correctCode){
                                    item.setCode(correctCode)
                                    correctionCount = correctionCount + 1
                                }
                            }
                        }
                    })
                }
            })

            console.log(`用时：${new Date().getTime() - timeStart} ms`)
            console.log(`显示词条数为： ${this.chosenWordIds.size}，纠正：${correctionCount} 个，需要删除：${errorCount} 个`)
        },

        // GROUP OPERATION
        // 添加新组
        addGroupBeforeId(groupIndex){
            // 只有当前选中的词典才允许写入
            if (!this.dict || !this.dict.fileName || this.dict.fileName !== this.dict.fileName) {
                this.tips.push('请先选择要操作的词典文件')
                return
            }
            this.dict.addGroupBeforeId(groupIndex)
            this.refreshShowingWords()
        },
        deleteGroup(groupId){
            // 只有当前选中的词典才允许写入
            if (!this.dict || !this.dict.fileName || this.dict.fileName !== this.dict.fileName) {
                this.tips.push('请先选择要操作的词典文件')
                return
            }
            this.dict.wordsOrigin.splice(groupId, 1)
            if (this.dict.wordsOrigin.length > 0){
                this.activeGroupId = 0 // 如果删除的是正在显示的组
            } else {
                this.activeGroupId = -1 // 如果删除后没有组了
            }
            this.refreshShowingWords()
        },
        // 设置当前显示的 分组
        setGroupId(groupId){ // groupId 全部的 id 是 -1
            this.activeGroupId = groupId
            this.refreshShowingWords()
            this.config.chosenGroupIndex = groupId
            ipcRenderer.send('saveConfigFileFromMainWindow', JSON.stringify(this.config))
        },
        // 刷新 this.words
        refreshShowingWords(){
            this.chosenWordIds.clear()
            this.chosenWordIdArray = []
            console.log('已选中的 groupIndex: ',this.activeGroupId, typeof this.activeGroupId)
            if (this.dict.isGroupMode){
                if (this.activeGroupId === -1){
                    this.words = [...this.dict.wordsOrigin]
                } else {
                    if (this.activeGroupId > this.dict.wordsOrigin.length - 1) {
                        this.activeGroupId = this.dict.wordsOrigin.length - 1
                    }
                    this.words = new Array(this.dict.wordsOrigin[this.activeGroupId])
                }
            } else {
                this.words = [...this.dict.wordsOrigin]
            }
        },
        addNewWord(){
            if (!this.word){
                shakeDomFocus(this.$refs.domInputWord)
            } else if (!this.code){
                shakeDomFocus(this.$refs.domInputCode)
            } else {
                // 只有当前选中的词典才允许写入
                if (this.dict && this.dict.fileName && this.dict.fileName === this.dict.fileName) {
                    // 创建新词条对象
                    const newWord = new Word(this.dict.lastIndex, this.code, this.word, this.priority, this.note);
                    this.dict.addNewWord(newWord, this.activeGroupId);
                    // 记录添加操作
                    logDictChange(this.dict.fileName, '添加', this.word, this.code, this.priority, this.note);
                    this.refreshShowingWords()
                    if (this.config.autoDeployOnAdd) {
                        this.saveToFile(this.dict)
                    }
                } else {
                    this.tips.push('请先选择要操作的词典文件')
                }
            }
        },

        // 保存内容到文件
        saveToFile(dict){
            // 只有当前选中的词典才允许写入
            if (!dict || !dict.fileName || dict.fileName !== this.dict.fileName) {
                this.tips.push('请先选择要操作的词典文件')
                return
            }
            ipcRenderer.send('saveFile', dict.fileName, dict.toYamlString())
        },
        // 选中全部展示的词条
        selectAll(){
            if(this.wordsCount < 100000){
                if (this.dict.isGroupMode){
                    this.chosenWordIds.clear()
                    this.chosenWordIdArray = []
                    this.words.forEach(group => { // group 是 dictGroup
                        group.dict.forEach( item => {
                            this.chosenWordIds.add(item.id)
                        })
                    })
                } else {
                    this.words.forEach(item => {this.chosenWordIds.add(item.id)})
                }
                this.chosenWordIdArray = [...this.chosenWordIds.values()]
            } else {
                // 提示不能同时选择太多内容
                this.tips.push('不能同时选择大于 十万 条的词条内容')
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
            // 只有当前选中的词典才允许写入
            if (!this.dict || !this.dict.fileName || this.dict.fileName !== this.dict.fileName) {
                this.tips.push('请先选择要操作的词典文件')
                return
            }
            // 在删除前获取词条信息以便记录日志
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
            if(this.config.autoDeployOnDelete){
                this.saveToFile(this.dict);
            }
        },
        // 删除词条：多
        deleteWords(){
            // 只有当前选中的词典才允许写入
            if (!this.dict || !this.dict.fileName || this.dict.fileName !== this.dict.fileName) {
                this.tips.push('请先选择要操作的词典文件')
                return
            }
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
            if(this.config.autoDeployOnDelete){
                this.saveToFile(this.dict);
            }
        },

        /**
         * 词条位置移动
         * @param wordId 词条 id
         * @param direction 方向
         * @param isSwitchPriority  是否调换两个词条的 Priority
         * @returns {string}
         */
        move(wordId, direction, isSwitchPriority){
            // 只有当前选中的词典才允许写入
            if (!this.dict || !this.dict.fileName || this.dict.fileName !== this.dict.fileName) {
                this.tips.push('请先选择要操作的词典文件')
                return
            }
            
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
                                    if (isSwitchPriority){
                                        // 调换两个词的权重值
                                        let tempPriority = group.dict[j].priority
                                        group.dict[j].priority = group.dict[j - 1].priority
                                        group.dict[j - 1].priority = tempPriority
                                    }
                                    return ''
                                } else {
                                    console.log('已到顶')
                                    return '已到顶'
                                }
                            } else if (direction === 'down'){
                                if (j+1 !== group.dict.length){
                                    group.dict[j] = group.dict[j + 1]
                                    group.dict[j + 1] = tempItem
                                    if (isSwitchPriority) {
                                        // 调换两个词的权重值
                                        let tempPriority = group.dict[j].priority
                                        group.dict[j].priority = group.dict[j + 1].priority
                                        group.dict[j + 1].priority = tempPriority
                                    }
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
                                if (isSwitchPriority) {
                                    // 调换两个词的权重值
                                    let tempPriority = this.words[i].priority
                                    this.words[i].priority = this.words[i - 1].priority
                                    this.words[i - 1].priority = tempPriority
                                }
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
                                if (isSwitchPriority) {
                                    // 调换两个词的权重值
                                    let tempPriority = this.words[i].priority
                                    this.words[i].priority = this.words[i + 1].priority
                                    this.words[i + 1].priority = tempPriority
                                }
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
        moveUp(id, isSwitchPriority){
            this.tips.push(this.move(id, 'up', isSwitchPriority))
            let temp = this.words.pop()
            this.words.push(temp)
        },
        // 下移词条
        moveDown(id, isSwitchPriority){
            this.tips.push(this.move(id, 'down', isSwitchPriority))
            let temp = this.words.pop()
            this.words.push(temp)
        },

        catalogMove(groupId, direction){
            // 只有当前选中的词典才允许写入
            if (!this.dict || !this.dict.fileName || this.dict.fileName !== this.dict.fileName) {
                this.tips.push('请先选择要操作的词典文件')
                return
            }
            
            if (direction === 'up'){
                if (groupId !== 0){
                    let tempItem = this.dict.wordsOrigin[groupId]
                    this.dict.wordsOrigin[groupId] = this.dict.wordsOrigin[groupId - 1]
                    this.dict.wordsOrigin[groupId - 1] = tempItem

                    if (this.activeGroupId === groupId){
                        this.activeGroupId = groupId - 1 // 跟随移动当前选中的分组
                        this.refreshShowingWords()
                    } else if (this.activeGroupId === groupId - 1){
                        this.activeGroupId = groupId // 跟随移动当前选中的分组
                        this.refreshShowingWords()
                    }
                } else {
                    console.log('组已在顶部')
                }
            } else if (direction === 'down'){
                if (groupId !== this.dict.wordsOrigin.length - 1){
                    let tempItem = this.dict.wordsOrigin[groupId]
                    this.dict.wordsOrigin[groupId] = this.dict.wordsOrigin[groupId + 1]
                    this.dict.wordsOrigin[groupId + 1] = tempItem

                    if (this.activeGroupId === groupId){
                        this.activeGroupId = groupId + 1 // 跟随移动当前选中的分组
                        this.refreshShowingWords()
                    } else if (this.activeGroupId === groupId + 1){
                        this.activeGroupId = groupId // 跟随移动当前选中的分组
                        this.refreshShowingWords()
                    }
                } else {
                    console.log('组已在底部')
                }
            }
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
            // 只有当前选中的词典才允许写入
            if (!this.dict || !this.dict.fileName || this.dict.fileName !== this.dict.fileName) {
                this.tips.push('请先选择要操作的源词典文件')
                this.resetDropList()
                return
            }
            
            // 目标词典必须有效
            if (!this.targetDict || !this.targetDict.fileName) {
                this.tips.push('请先选择目标词典文件')
                this.resetDropList()
                return
            }
            
            let wordsTransferring = [] // 被转移的 [Word]
            if (this.dict.isGroupMode){
                this.dict.wordsOrigin.forEach((group, index) => {
                    let matchedWords = group.dict.filter(item => this.chosenWordIds.has(item.id))
                    wordsTransferring = wordsTransferring.concat(matchedWords)
                })
            } else {
                wordsTransferring = this.dict.wordsOrigin.filter(item => this.chosenWordIds.has(item.id))
            }
            
            if (this.dict.fileName === this.targetDict.fileName){ // 如果是同词库移动
                this.targetDict.deleteWords(this.chosenWordIds, true) // 删除移动的词条
                this.targetDict.addWordsInOrder(wordsTransferring, this.dropdownActiveGroupIndex)
                this.saveToFile(this.targetDict)
                this.reloadCurrentDict()
            } else {
                this.targetDict.addWordsInOrder(wordsTransferring, this.dropdownActiveGroupIndex)
                this.words = [...this.dict.wordsOrigin]
                this.deleteWords() // 删除当前词库已移动的词条
                this.saveToFile(this.targetDict)
                this.saveToFile(this.dict)
            }
            this.tips.push('移动成功')
            this.resetDropList()
        },
        // 复制 dropdown
        resetDropList(){
            this.isShowDropdown = false
            this.dropdownActiveFileIndex = -1
            this.dropdownActiveGroupIndex = -1
            this.targetDict = {} // 清空次码表
        },
        // 打开当前码表源文件
        openCurrentYaml(){
            ipcRenderer.send('openFileOutside', this.dict.fileName)
        },
        // 重新载入当前码表
        reloadCurrentDict(){
            ipcRenderer.send('loadDictFile', this.dict.fileName)
        },

        // 导出选中词条到 plist 文件
        exportSelectionToPlist(){
            let wordsSelected = [] // 被选中的 [Word]
            if (this.dict.isGroupMode){
                this.dict.wordsOrigin.forEach((group, index) => {
                    let matchedWords = group.dict.filter(item => this.chosenWordIds.has(item.id))
                    wordsSelected = wordsSelected.concat(matchedWords)
                })
            } else {
                wordsSelected = this.dict.wordsOrigin.filter(item => this.chosenWordIds.has(item.id))
            }
            ipcRenderer.send('MainWindow:ExportSelectionToPlistFile', wordsSelected)
        },        // 上传当前码表到 git
        async uploadToGit() {
            // 上传前先比对本地和远程内容
            const res = await ipcRenderer.invoke('checkDictsDiff', 'upload')
            if (res && res.same) {
                this.dialogMsg = '本地词库与远程仓库一致，无需上传';
                this.showDialog = true;
                // 移除自动关闭定时器，改为点击关闭
                return;
            }
            // 提示用户同步操作
            this.dialogMsg = '正在同步词典文件...';
            this.showDialog = true;
            
            ipcRenderer.send('uploadToGit');
        },        // 下载当前码表到 git
        async downloadFromGit() {
            // 下载前先比对本地和远程内容
            const res = await ipcRenderer.invoke('checkDictsDiff', 'download')
            if (res && res.same) {
                this.dialogMsg = '本地词库与远程仓库一致，无需下载';
                this.showDialog = true;
                // 移除自动关闭定时器，改为点击关闭
                return;
            }
            // 提示用户同步操作
            this.dialogMsg = '正在同步词典文件...';
            this.showDialog = true;
            
            ipcRenderer.send('downloadFromGit');
        }
    },
    watch: {
        tips(){
          this.tipNotice()
        },
        code(newValue){
            this.code = newValue.replaceAll(/[^A-Za-z ]/g, '') // input.code 只允许输入字母
            // 主码表中的词
            let wordsMainDictRedundancy = []
            if (this.dictMain && this.dictMain.wordsOrigin) {
                if (this.dictMain.isGroupMode) {
                    this.dictMain.wordsOrigin.forEach(wordGroup => {
                        wordsMainDictRedundancy.push(...wordGroup.dict.filter(item => item.code === newValue))
                    })
                } else {
                    wordsMainDictRedundancy = this.dictMain.wordsOrigin.filter(item => item.code === newValue)
                }
                wordsMainDictRedundancy = wordsMainDictRedundancy.map(item => {
                    item.origin = this.fileNameListMap.get(this.config.mainDictFileName) || '主码表'
                    return item
                })
            }
            // 用户词库中的词
            let wordsCurrentDictRedundancy = []
            if (this.dict && this.dict.wordsOrigin) {
                if (this.dict.isGroupMode) {
                    this.dict.wordsOrigin.forEach(wordGroup => {
                        wordsCurrentDictRedundancy.push(...wordGroup.dict.filter(item => item.code === newValue))
                    })
                } else {
                    wordsCurrentDictRedundancy = this.dict.wordsOrigin.filter(item => item.code === newValue)
                }
                wordsCurrentDictRedundancy = wordsCurrentDictRedundancy.map(item => {
                    item.origin = '当前码表'
                    return item
                })
            }
            this.wordsRedundancy = wordsMainDictRedundancy.concat(wordsCurrentDictRedundancy)
        },
        word(newValue, oldValue){
            if (/[a-z]/i.test(newValue)){
                // 当新词包含英文时， 删除 word 不改变 code
            } else {
                if (this.dictMap){
                    this.code = this.dictMap.decodeWord(newValue)
                }
            }
        },
        chosenWordIdArray(newValue){
            if (newValue.length === 0){
                this.isShowDropdown = false
            }
            console.log('已选词条id: ', JSON.stringify(newValue))
        },
        isShowDropdown(newValue){
            if (!newValue){ // 窗口关闭时，重置 index
                this.resetDropList()
            }
        },
        config: (newValue) => {
            switch (newValue.theme){
                case "auto":
                    document.documentElement.classList.add('theme-auto');
                    document.documentElement.classList.remove('theme-dark');
                    document.documentElement.classList.remove('theme-white');
                    break;
                case "black":
                    document.documentElement.classList.remove('theme-auto');
                    document.documentElement.classList.add('theme-dark');
                    document.documentElement.classList.remove('theme-white');
                    break;
                case "white":
                    document.documentElement.classList.remove('theme-auto');
                    document.documentElement.classList.remove('theme-dark');
                    document.documentElement.classList.add('theme-white');
                    break;
            }
        }
    }
}

new Vue(app)
