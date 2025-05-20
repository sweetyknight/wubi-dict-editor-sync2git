// const IS_IN_DEVELOP = false // 生产模式，上传到公共仓库应设为false
const IS_IN_DEVELOP = true // 开发模式

const CONFIG_FILE_NAME = 'config.json' // 配置文件 文件名
const CONFIG_DICT_MAP_FILE_NAME = 'dict_map.txt' // 编码生成用的字典码表文件
const CONFIG_FILE_PATH = 'wubi-dict-editor-sync2git' // 配置文件存放的目录

const DEFAULT_CONFIG = {
    initFileName: 'wubi86_jidian_user.dict.yaml',  // 初始文件信息
    autoDeployOnAdd: true,                        // 添词后 是否自动部署
    autoDeployOnDelete: true,                     // 删词后 是否自动部署
    autoDeployOnEdit: true,                       // 编辑词条后 是否自动部署
    enterKeyBehavior: 'add',                       // add | search
    rimeHomeDir: '',                               // 配置文件主目录
    rimeExecDir: '',                               // 输入法程序主目录
    searchMethod: 'both',                          // 搜索匹配的内容  code | phrase | both | any
    chosenGroupIndex: -1,                          // 列表中选定的分组 id
    theme: 'auto',                                 // auto 跟随系统 | black | white
    hasSetDictMap: false,                          // 是否已经设置字典码表文件
    isToolPanelShowing: true,                      // index.html 工具面板是否展开
    fileNameList: [],                              // 匹配文件名，显示自定义码表文件的名字
        // [{ "name": "luna_pinyin.sogou", "path": "luna_pinyin.sogou.dict.yaml" }]
    mainDictFileName: 'wubi86_jidian.dict.yaml',   // 主词库文件名 
    // 新增GitHub API配置项
    // GitHub API配置项（请用户根据自己的仓库设置填写）
    githubOwner: '',                               // GitHub用户名
    githubRepo: '',                                // 仓库名称
    githubBranch: 'main',                          // 分支名称，默认main
    githubToken: '',                               // GitHub访问令牌（用户需自行设置）
    githubFolder: '',                              // GitHub仓库中的文件夹（可选）
    syncDictFiles: [                               // 需要同步的词库文件
        'wubi86_jidian.dict.yaml',
        'wubi86_jidian_user.dict.yaml',
        'wubi86_jidian_user_hamster.dict.yaml',
        'wubi86_jidian_extra.dict.yaml',
        'wubi86_jidian_extra_district.dict.yaml'
    ]
}

module.exports = {
    IS_IN_DEVELOP,
    CONFIG_FILE_NAME,
    CONFIG_FILE_PATH,
    DEFAULT_CONFIG,
    CONFIG_DICT_MAP_FILE_NAME
}
