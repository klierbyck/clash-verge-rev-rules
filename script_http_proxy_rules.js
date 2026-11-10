// Define main function (script entry)
// function main(config, profileName) {
//   return config;
// }
// Clash Verge Rev 全局扩展脚本（Mihomo 内核）
// 在全局扩展脚本编辑器中完整替换；先填写住宅节点的 server / username / password。
// 使用远程规则集进行分流，未匹配流量默认直连。
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

const ruleProviderCommon = {
  type: "http",
  format: "text",
  behavior: "classical",
  interval: 604800,
};

const ruleProviders = {
  ai: {
    ...ruleProviderCommon,
    path: "./ruleset/ai.list",
    url: "https://raw.githubusercontent.com/klierbyck/clash-verge-rev-rules/refs/heads/master/ruleset/ai.list",
  },
  social: {
    ...ruleProviderCommon,
    path: "./ruleset/social.list",
    url: "https://raw.githubusercontent.com/klierbyck/clash-verge-rev-rules/refs/heads/master/ruleset/social.list",
  },
  common: {
    ...ruleProviderCommon,
    path: "./ruleset/common.list",
    url: "https://raw.githubusercontent.com/klierbyck/clash-verge-rev-rules/refs/heads/master/ruleset/common.list",
  },
  global: {
    ...ruleProviderCommon,
    path: "./ruleset/global.list",
    url: "https://raw.githubusercontent.com/klierbyck/clash-verge-rev-rules/refs/heads/master/ruleset/global.list",
  },
};

// 直连例外必须先于规则集，具体业务先于国外通用；国内组仅作兜底，不判断目标地区。
const rules = [
  "RULE-SET,ai,👽 AI",
  "RULE-SET,social,💬 社交账号",
  "RULE-SET,common,📦 日常应用",
  "RULE-SET,global,🌍 国外",
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

  // 连接信息均为示例，请替换为实际住宅 IP；没有的地区删除对应条目，也可将数组留空。
  // 复制条目即可增加地区；region 必须唯一，同地区多个 IP 可命名为“美国-1”“美国-2”。
  const residentialConfigs = [
    {
      region: "美国",
      server: "us-residential.example.com",
      port: 5782,
      username: "us_username",
      password: "us_password",
    },
    {
      region: "日本",
      server: "jp-residential.example.com",
      port: 5782,
      username: "jp_username",
      password: "jp_password",
    },
  ];
  const residentialRegions = residentialConfigs.map(({ region }) => region);
  if (
    residentialRegions.some(
      (region) => typeof region !== "string" || !region.trim(),
    ) ||
    new Set(residentialRegions).size !== residentialRegions.length
  ) {
    throw new Error("住宅配置中的 region 必须是非空且唯一的名称");
  }

  // 普通 SOCKS5 不启用 TLS；各住宅出口均经同一个机场前置组，不在住宅 IP 之间自动切换。
  const residentialNodes = residentialConfigs.map(({ region, ...node }) => ({
    ...node,
    name: `🏠 静态住宅落地-${region}`,
    type: "socks5",
    "dialer-proxy": entranceGroupName,
  }));
  const residentialGroupNames = residentialRegions.map(
    (region) => `🔗 链式-住宅IP-${region}`,
  );
  // 此命名前缀由脚本管理，同时排除旧单住宅节点，避免重复执行或删减地区后残留节点。
  const residentialExcludeFilter = "^🏠 静态住宅落地(?:-.*)?$";
  const residentialNamePattern = new RegExp(residentialExcludeFilter);
  config.proxies = [
    ...(Array.isArray(config.proxies) ? config.proxies : []).filter(
      (proxy) => !residentialNamePattern.test(proxy.name),
    ),
    ...residentialNodes,
  ];

  // 完整沿用订阅的 DNS 和 hosts，保留机场节点的本地解析及域名映射链路。
  // 节点解析可能依赖本地 DNS，不在扩展脚本中替换解析服务器或追加 fallback。

  // 4. 定义代理组
  config["proxy-groups"] = [
    ...residentialNodes.map((node, index) => ({
      ...groupBaseOption,
      name: residentialGroupNames[index],
      type: "select",
      proxies: [node.name],
    })),
    {
      ...groupBaseAutoTest,
      name: "所有-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": residentialExcludeFilter,
    },
    {
      ...groupBaseAutoTest,
      name: "港台日新韩-自动",
      lazy: false, // 仅核心前置组保持后台测速。
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": residentialExcludeFilter, // 机场组排除住宅节点，避免误选住宅及潜在的链式依赖环。
      filter:
        "(广港|广台|广日|广新|广韩|香港|HK|Hong Kong|🇭🇰|HongKong|台湾|TW|Tai Wan|🇹🇼|🇨🇳|TaiWan|Taiwan|日本|JP|川日|东京|大阪|泉日|埼玉|沪日|深日|🇯🇵|Japan|新加坡|SG|坡|狮城|🇸🇬|Singapore|韩国|KR|首尔|春川|🇰🇷|Korea)",
    },
    {
      ...groupBaseAutoTest,
      name: "台日新韩-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": residentialExcludeFilter,
      filter:
        "(广台|广日|广新|广韩|台湾|TW|Tai Wan|🇹🇼|🇨🇳|TaiWan|Taiwan|日本|JP|川日|东京|大阪|泉日|埼玉|沪日|深日|🇯🇵|Japan|新加坡|SG|坡|狮城|🇸🇬|Singapore|韩国|KR|首尔|春川|🇰🇷|Korea)",
    },
    {
      ...groupBaseAutoTest,
      name: "日新韩-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": residentialExcludeFilter,
      filter:
        "(广日|广新|广韩|日本|JP|川日|东京|大阪|泉日|埼玉|沪日|深日|🇯🇵|Japan|新加坡|SG|坡|狮城|🇸🇬|Singapore|韩国|KR|首尔|春川|🇰🇷|Korea)",
    },
    {
      ...groupBaseOption,
      name: "香港-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": residentialExcludeFilter,
      filter: "(广港|香港|HK|Hong Kong|🇭🇰|HongKong)",
    },
    {
      ...groupBaseOption,
      name: "台湾-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": residentialExcludeFilter,
      filter: "(广台|台湾|台灣|TW|Tai Wan|🇹🇼|🇨🇳|TaiWan|Taiwan)",
    },
    {
      ...groupBaseOption,
      name: "日本-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": residentialExcludeFilter,
      filter: "(广日|日本|JP|川日|东京|大阪|泉日|埼玉|沪日|深日|🇯🇵|Japan)",
    },
    {
      ...groupBaseOption,
      name: "新加坡-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": residentialExcludeFilter,
      filter: "(广新|新加坡|SG|坡|狮城|🇸🇬|Singapore)",
    },
    {
      ...groupBaseOption,
      name: "韩国-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": residentialExcludeFilter,
      filter: "(广韩|韩国|韓國|KR|首尔|春川|🇰🇷|Korea)",
    },
    {
      ...groupBaseAutoTest,
      name: "美国-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": residentialExcludeFilter,
      filter:
        "(广美|美|USA|纽约|波特兰|达拉斯|俄勒|凤凰城|费利蒙|硅谷|拉斯|洛杉|圣何塞|圣克拉|西雅|芝加|🇺🇸|United States)",
    },
    {
      ...groupBaseOption,
      name: "其他-自动",
      type: "url-test",
      proxies: [],
      "include-all": true,
      "exclude-filter": residentialExcludeFilter,
      filter:
        "(波|柬|尼|也|克|比|尔|立|冰|秘|耳|利|埃|希|孟|芬|愛|澳|英|德|南|意|法|拿|墨|印|越|俄|瑞|智|荷|比|巴|沙|班|泰|德|烏|以|Australia|Konghwaguk)",
    },
    {
      ...groupBaseOption,
      name: "👽 AI",
      type: "select",
      proxies: [
        ...residentialGroupNames,
        "美国-自动",
        "台湾-自动",
        "日本-自动",
        "台日新韩-自动",
      ],
    },
    {
      ...groupBaseOption,
      name: "💬 社交账号",
      type: "select",
      proxies: [
        ...residentialGroupNames,
        "美国-自动",
        "台湾-自动",
        "日本-自动",
        "台日新韩-自动",
        "港台日新韩-自动",
      ],
    },
    {
      ...groupBaseOption,
      name: "📦 日常应用",
      type: "select",
      proxies: [
        ...residentialGroupNames,
        "港台日新韩-自动",
        "台日新韩-自动",
        "美国-自动",
      ],
    },
    {
      ...groupBaseOption,
      name: "🌍 国外",
      type: "select",
      proxies: ["港台日新韩-自动", "日新韩-自动", "美国-自动"],
    },
    {
      ...groupBaseOption,
      name: "➡️ 国内",
      type: "select",
      proxies: ["DIRECT"],
    },
  ];

  // 5. 统一设置分流规则集和规则，覆盖订阅中的同名配置字段。
  config["rule-providers"] = ruleProviders;
  config["rules"] = rules;

  return config;
}
