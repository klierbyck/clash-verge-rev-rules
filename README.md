# clash客户端分流规则配置—让你的clash更简单好用！

## clash-verge-rev[下载](https://github.com/clash-verge-rev/clash-verge-rev/releases)

# 说明

## 项目目录中有两个配置文件，分别是script_http（线上分流规则集）和script_local(本地分流规则集，需要下载到本地使用)，建议先试用线上分流规则集，熟练后再使用本地分流规则集自定义属于自己的规则集

## 打开客户端->点击订阅->右击全局扩展脚本->编辑文件->将项目中的script_xxx文件内容复制到编辑框中，然后点击保存即可

## 若使用script_http则不需要任何操作即可开启你的分流之旅

![预览](./img/img1.png)

## 若使用script_local将项目中的ruleset目录及所有文件复制到配置目录

![预览](./img/img2.png)
![预览](./img/img3.png)

# 使用

## 点击代理->规则->找到对应分组，选择对应规则即可（目前有AI、Github、Telegram、流媒体、国外五个规则集）记得国内选DIRECT

![预览](./img/img4.png)

## 最后右键clash图标打开规则规则模式和TUN模式即可

![预览](./img/img5.png)

## 注意：配置完需要重启clash客户端

## script_xxx.js有关键配置注释，可以根据自己的需求自行修改

# 链式代理配置（可选）

## 如果有住宅IP，可以在script_xxx.js中按照下图填写信息，然后选择`🔗 链式-住宅IP`分组，最终链路即本机 → 港台日新韩的机场节点自动选择 → 住宅IP → 目标网站

![预览](./img/img6.png)
![预览](./img/img7.png)

## 如果没有住宅IP，`🔗 链式-住宅IP`分组会显示Error，选择其他可用自动分组，最终链路即本机 → 对应分组的机场节点自动选择 → 目标网站
