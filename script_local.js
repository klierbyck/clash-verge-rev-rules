// Define main function (script entry)
// function main(config, profileName) {
//   return config;
// }
// Clash Verge Rev 全局扩展脚本（Mihomo 内核）
// 在全局扩展脚本编辑器中完整替换；先填写住宅节点的 server / username / password。
// 使用本地规则集进行分流，未匹配流量默认直连。
// select 组不会在连接失败时自动切换出口。

// 代理组通用配置
const groupBaseOption = {
  // 健康检查间隔，单位为秒。
  interval: 300,
  timeout: 6000, // 健康检查超时为 6000 毫秒，避免慢连接被过早判定为不可用。
  url: "https://www.gstatic.com/generate_204", // 通过 HTTPS 请求检测节点连通性和延迟。
  lazy: true, // 未使用的组不持续定时测速；仍可手动触发。
  "max-failed-times": 3,
  hidden: false,
  tolerance: 60, // 切换容差为 60 毫秒，减少网络波动引起的频繁切换。
};

// 自动测速配置
const groupBaseAutoTest = {
  ...groupBaseOption,
  lazy: true, // 普通自动组按需测速；前置组单独保持持续测速。
};

// 规则集通用配置
const ruleProviderCommon = {
  type: "file",
  format: "yaml",
  interval: 86400,
};

// 规则集配置
const ruleProviders = {
  ai: {
    ...ruleProviderCommon,
    behavior: "classical",
    type: "file",
    path: "./ruleset/ai.yaml",
  },
  github: {
    ...ruleProviderCommon,
    behavior: "classical",
    type: "file",
    path: "./ruleset/github.yaml",
  },
  telegram: {
    ...ruleProviderCommon,
    behavior: "classical",
    type: "file",
    path: "./ruleset/telegram.yaml",
  },
  media: {
    ...ruleProviderCommon,
    behavior: "classical",
    type: "file",
    path: "./ruleset/media.yaml",
  },
  global: {
    ...ruleProviderCommon,
    behavior: "classical",
    type: "file",
    path: "./ruleset/global.yaml",
  },
};

// 分流规则按顺序匹配，首个命中规则决定出口。
const rules = [
  "RULE-SET,ai,👽 AI",
  "RULE-SET,github,📘 GitHub",
  "RULE-SET,telegram,🙋 Telegram",
  "RULE-SET,media,📀 流媒体",
  "RULE-SET,global,🌍 国外",
  // 所有未匹配流量进入国内组；此兜底规则不判断目标所属地区。
  "MATCH,➡️ 国内",
];

// 程序入口
function main(config) {
  // 检查配置类型，避免 null 或错误的数据类型触发难以定位的异常。
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("配置必须是有效对象");
  }
  const proxyCount = Array.isArray(config.proxies) ? config.proxies.length : 0;
  const providers = config["proxy-providers"];
  const proxyProviderCount =
    providers && typeof providers === "object" && !Array.isArray(providers)
      ? Object.keys(providers).length
      : 0;
  if (proxyCount === 0 && proxyProviderCount === 0) {
    throw new Error("配置文件中未找到任何代理");
  }

  // 1. 定义前置节点组名称 (必须在下面 proxy-groups 中存在)
  const entranceGroupName = "港台日新韩-自动";

  // 2. 定义静态住宅 IP 节点，并直接绑定前置代理组
  const myStaticNode = {
    name: "🏠 静态住宅落地",
    type: "socks5",
    server: "xxx.xxx.xxx.xxx",
    port: 5782,
    username: "test",
    password: "12345678",
    // 当前使用普通 SOCKS5，不启用 TLS。
    // 连接路径：本机 → 前置组选择的机场节点 → 住宅节点 → 目标网站。
    "dialer-proxy": entranceGroupName,
  };

  // 3. 按名称替换注入，避免同一配置重复执行时添加同名住宅节点。
  config.proxies = [
    ...(Array.isArray(config.proxies) ? config.proxies : [])
      .filter((proxy) => proxy.name !== myStaticNode.name),
    myStaticNode,
  ];

  // 完整沿用订阅的 DNS 和 hosts，保留机场节点的本地解析及域名映射链路。
  // 节点解析可能依赖本地 DNS，不在扩展脚本中替换解析服务器或追加 fallback。

  // 4. 定义代理组
  config["proxy-groups"] = [
    // 住宅 IP 专用选择组
    {
      ...groupBaseOption,
      name: "🔗 链式-住宅IP",
      type: "select", // 住宅出口使用单节点选择组，不进行自动择优。
      proxies: [myStaticNode.name], // 此时连接该节点会自动经过 entranceGroupName
    },
    {
      ...groupBaseAutoTest,
      name: "所有-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": "^🏠 静态住宅落地$",
    },
    {
      ...groupBaseAutoTest,
      name: "港台日新韩-自动",
      lazy: false, // 仅核心前置组保持后台测速。
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": "^🏠 静态住宅落地$", // 机场组排除住宅节点，避免误选住宅及潜在的链式依赖环。
      filter:
        "(广港|广台|广日|广新|广韩|香港|HK|Hong Kong|🇭🇰|HongKong|台湾|TW|Tai Wan|🇹🇼|🇨🇳|TaiWan|Taiwan|日本|JP|川日|东京|大阪|泉日|埼玉|沪日|深日|🇯🇵|Japan|新加坡|SG|坡|狮城|🇸🇬|Singapore|韩国|KR|首尔|春川|🇰🇷|Korea)",
    },
    {
      ...groupBaseAutoTest,
      name: "台日新韩-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": "^🏠 静态住宅落地$",
      filter:
        "(广台|广日|广新|广韩|台湾|TW|Tai Wan|🇹🇼|🇨🇳|TaiWan|Taiwan|日本|JP|川日|东京|大阪|泉日|埼玉|沪日|深日|🇯🇵|Japan|新加坡|SG|坡|狮城|🇸🇬|Singapore|韩国|KR|首尔|春川|🇰🇷|Korea)",
    },
    {
      ...groupBaseAutoTest,
      name: "日新韩-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": "^🏠 静态住宅落地$",
      filter:
        "(广日|广新|广韩|日本|JP|川日|东京|大阪|泉日|埼玉|沪日|深日|🇯🇵|Japan|新加坡|SG|坡|狮城|🇸🇬|Singapore|韩国|KR|首尔|春川|🇰🇷|Korea)",
    },
    {
      ...groupBaseOption,
      name: "香港-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": "^🏠 静态住宅落地$",
      filter: "(广港|香港|HK|Hong Kong|🇭🇰|HongKong)",
    },
    {
      ...groupBaseOption,
      name: "台湾-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": "^🏠 静态住宅落地$",
      filter: "(广台|台湾|台灣|TW|Tai Wan|🇹🇼|🇨🇳|TaiWan|Taiwan)",
    },
    {
      ...groupBaseOption,
      name: "日本-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": "^🏠 静态住宅落地$",
      filter: "(广日|日本|JP|川日|东京|大阪|泉日|埼玉|沪日|深日|🇯🇵|Japan)",
    },
    {
      ...groupBaseOption,
      name: "新加坡-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": "^🏠 静态住宅落地$",
      filter: "(广新|新加坡|SG|坡|狮城|🇸🇬|Singapore)",
    },
    {
      ...groupBaseOption,
      name: "韩国-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": "^🏠 静态住宅落地$",
      filter: "(广韩|韩国|韓國|KR|首尔|春川|🇰🇷|Korea)",
    },
    {
      ...groupBaseAutoTest,
      name: "美国-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": "^🏠 静态住宅落地$",
      filter:
        "(广美|美|USA|纽约|波特兰|达拉斯|俄勒|凤凰城|费利蒙|硅谷|拉斯|洛杉|圣何塞|圣克拉|西雅|芝加|🇺🇸|United States)",
    },
    {
      ...groupBaseOption,
      name: "其他-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": "^🏠 静态住宅落地$",
      filter:
        "(波|柬|尼|也|克|比|尔|立|冰|秘|耳|利|埃|希|孟|芬|愛|澳|英|德|南|意|法|拿|墨|印|越|俄|瑞|智|荷|比|巴|沙|班|泰|德|烏|以|Australia|Konghwaguk)",
    },
    {
      ...groupBaseOption,
      name: "👽 AI",
      type: "select",
      proxies: ["🔗 链式-住宅IP", "日新韩-自动", "美国-自动"],
    },
    {
      ...groupBaseOption,
      name: "📘 GitHub",
      type: "select",
      proxies: ["港台日新韩-自动", "日新韩-自动", "美国-自动"],
    },
    {
      ...groupBaseOption,
      name: "🙋 Telegram",
      type: "select",
      proxies: ["港台日新韩-自动", "日新韩-自动", "美国-自动"],
    },
    {
      ...groupBaseOption,
      name: "📀 流媒体",
      type: "select",
      proxies: ["港台日新韩-自动", "日新韩-自动", "美国-自动"],
    },
    {
      ...groupBaseOption,
      name: "🌍 国外",
      type: "select",
      proxies: [
        "🔗 链式-住宅IP",
        "港台日新韩-自动",
        "日新韩-自动",
        "美国-自动",
      ],
    },
    {
      ...groupBaseOption,
      name: "➡️ 国内",
      type: "select",
      proxies: ["DIRECT", "所有-自动"],
    },
  ];

  // 5. 统一设置分流规则集和规则，覆盖订阅中的同名配置字段。
  config["rule-providers"] = ruleProviders;
  config["rules"] = rules;

  return config;
}
