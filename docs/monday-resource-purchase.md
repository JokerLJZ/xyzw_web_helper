# 周一万能红碎片及成长脆饼采购

从public/game/main.2a00e.js加载的game/index.22c3b.jsc核对接口：

- ActCollectionShopModule.refreshStoreRecord：CollectionService.goodsList({})，返回storeInfo.exchangeStoreMap；getExchangeGoods取对应商品buyNum，缺失项视为0。
- exchangeGoods：CollectionService.exchange({goodsId,goodsNum})，命令collection_exchange。
- LegionModule.sendStoreGoodsList：LegionService.storeGoodsList({})，返回buyGoods商品ID到数量的映射。
- sendStoreBuyGoods：LegionService.storeBuyGoods({id,num})，命令legion_storebuygoods。LegionShopDialog盐晶商店ID为4，购买弹窗传实际份数。

配置及语言来源（游戏manifest的dataBundleVer=4921343dff）：

- https://xxz-xyzw-res.hortorgames.com/data/4921343dff/config.json
- https://xxz-xyzw-res.hortorgames.com/data/4921343dff/config_ap.json
- https://xxz-xyzw-res.hortorgames.com/data/4921343dff/language.json

CollectionExchangeShopConf[6001]：每份5个曜晶徽记70001，兑换10个万能红将碎片3201，限购10份。LegionStoreConf[203]：每份10盐晶1038，兑换1000成长脆饼15001，限购60份。具体限购刷新由游戏服务端列表决定；任务每次先读取当前已购份数，不凭本地记录推断。

已检查要求的magic/api采集目录中俱乐部与商城相关记录目录，未发现匹配的珍宝阁兑换和盐晶成长脆饼采购记录；上述接口与数据来自game加载的官方代码与配置，测试响应为按其结构模拟，不冒充实号抓包。

同一个日常设置选项mondayResourcePurchase，默认false。北京时间周一才运行，入口与消耗请求前均检查星期。兑换数量取资源可支付份数与剩余限购额度较小值；请求后重新读取商店，只有额度精确增加才确认成功；超时、限流或异常响应停止，不自动重发。两项均只使用各自兑换资源，不购买礼包或充值。

独立小号批量任务`batchBuyRedFragmentsAndPetCookies`通过`onlyMonday:false`复用采购，任何星期均可手动/定时执行。日常入口保留默认`onlyMonday:true`与默认关闭开关。停止时在下一采购前检查取消状态，已发送的采购仍查询额度确认，不自动重试。
