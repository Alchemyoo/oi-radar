/* 股票与传统金融合约终端（Binance TRADIFI_PERPETUAL）
 * 覆盖美股科技/半导体、杠杆与指数ETF、Pre-IPO独角兽、港韩亚太股、大宗商品与外汇永续合约。
 * 严格遵循客观数据口径：实时行情与费率基差来自 Binance fapi，持仓来自快照与实时接口，不做黑盒预测。 */
'use strict';
(function(root){
  /* 已知 245 个 Binance TRADIFI_PERPETUAL 合约集合（exchangeInfo 加载前即可秒级准确识别并隔离 CoinGecko 同名币碰撞） */
  const TRADFI_KNOWN=new Set([
    'AAOIUSDT','AAPLUSDT','ABBVUSDT','ACNUSDT','ADBEUSDT','AGPUUSDT','AKAMUSDT','ALABUSDT','AMCUSDT','AMDLUSDT',
    'AMDUSDT','AMGNUSDT','AMATUSDT','AMZNUSDT','ANETUSDT','ANTUSDT','APLDUSDT','APPUSDT','ARMUSDT','ARTYUSDT',
    'ASMLUSDT','ASTSUSDT','AVGOUSDT','AXTIUSDT','BABAUSDT','BACUSDT','BBXUSDT','BEUSDT','BITOUSDT','BMNRUSDT',
    'BNCUSDT','BOTUSDT','BRKBUSDT','BSPUSDT','BWETUSDT','BXUSDT','BYDUSDT','BZUSDT','CATUSDT','CBRSUSDT',
    'CCJUSDT','CEGUSDT','CIENUSDT','CLUSDT','COHRUSDT','COINUSDT','COPPERUSDT','COSTUSDT','CRCLUSDT','CRDOUSDT',
    'CRMLUSDT','CRMUSDT','CRWDUSDT','CRWVUSDT','CSCOUSDT','CSOPSAMSUNG2LUSDT','CSOPSKHYNIX2LUSDT','CVNAUSDT','CXMTUSDT','CYPHUSDT',
    'DDOGUSDT','DELLUSDT','DISUSDT','DJTUSDT','DKNGUSDT','DRAMUSDT','EBAYUSDT','EIDOUSDT','EQTUSDT','ETNUSDT',
    'EWJUSDT','EWTUSDT','EWYUSDT','EWZUSDT','EWZSUSDT','FLEXUSDT','FLNCUSDT','FRHCUSDT','FWDIUSDT','GDXUSDT',
    'GEVUSDT','GIGADEVUSDT','GLWUSDT','GMEUSDT','GOOGLUSDT','GPROUSDT','GSUSDT','GTLBUSDT','HANMIUSDT','HDUSDT',
    'HIMSUSDT','HK0625USDT','HK0700USDT','HK0992USDT','HK1810USDT','HOODUSDT','HPEUSDT','HUTUSDT','HYUNDAIUSDT','IBITUSDT',
    'IBKRUSDT','IBMUSDT','IGVUSDT','INTCUSDT','INTWUSDT','IONQUSDT','IRENUSDT','IWMUSDT','JNJUSDT','JPMUSDT',
    'KLACUSDT','KODEX200USDT','KORUUSDT','KOUSDT','KSTRUSDT','KUAISHOUUSDT','LGELECTRONICSUSDT','LITEUSDT','LLYUSDT','LRCXUSDT',
    'LYTEUSDT','MARAUSDT','MCDUSDT','MDBUSDT','MDTUSDT','MEITUANUSDT','MELIUSDT','METAUSDT','MINIMAXUSDT','MOONSHOTUSDT',
    'MPUSDT','MRKUSDT','MRNAUSDT','MRVLUSDT','MSFTUSDT','MSTRUSDT','MSTUUSDT','MUUSDT','MUUUSDT','MVLLUSDT',
    'NATGASUSDT','NAVERUSDT','NBISUSDT','NETUSDT','NFLXUSDT','NIOUSDT','NKEUSDT','NOKUSDT','NOWUSDT','NUUSDT',
    'NVDAUSDT','NVDLUSDT','NVOUSDT','OKLOUSDT','ONDSUSDT','OPENAIUSDT','ORCLUSDT','OURAUSDT','OXYUSDT','PANWUSDT',
    'PATHUSDT','PAYPUSDT','PDDUSDT','PENGUSDT','PFEUSDT','PLTRUSDT','POPMARTUSDT','PYPLUSDT','QCOMUSDT','QNTXUSDT',
    'QQQUSDT','RAMUSDT','RDDTUSDT','RDWUSDT','RIVNUSDT','RKLBUSDT','RUMUSDT','SAMSUNGEMUSDT','SAMSUNGUSDT','SECZUSDT',
    'SHAZUSDT','SHOPUSDT','SKDDUSDT','SKHYNIXUSDT','SKHYUSDT','SKUUUSDT','SMCIUSDT','SMHUSDT','SMRUSDT','SNDKUSDT',
    'SNOWUSDT','SNPSUSDT','SNXXUSDT','SOFIUSDT','SONYUSDT','SOXLUSDT','SOXSUSDT','SOXXUSDT','SPCXUSDT','SPYUSDT',
    'SQQQUSDT','STMUSDT','STRCUSDT','STXXUSDT','TBTUSDT','TEAMUSDT','TEMUSDT','TENCENTUSDT','TERUSDT','TMFUSDT',
    'TQQQUSDT','TSLAUSDT','TSLLUSDT','TSMUSDT','TTWOUSDT','TWSTUSDT','TXNUSDT','TZAUSDT','UBERUSDT','UNHUSDT',
    'UNITREEUSDT','URNMUSDT','USARUSDT','USDBRLUSDT','USDEXUSDT','UVXYUSDT','VKTXUSDT','VRTUSDT','VSTUSDT','VUSDT',
    'WDCUSDT','WENUSDT','WMTUSDT','XAGUSDT','XAUUSDT','XBIUSDT','XLEUSDT','XOMUSDT','XPDUSDT','XPTUSDT',
    'ZCSHUSDT','ZHIPUUSDT','ZHONGJIUSDT','ZMUSDT','ZSUSDT'
  ]);

  /* 标的中文简称与细分板块字典 */
  const META={
    NVDA:{n:'英伟达 NVIDIA',s:'semi',tv:'NASDAQ:NVDA'},AMD:{n:'超威半导体 AMD',s:'semi',tv:'NASDAQ:AMD'},
    TSM:{n:'台积电 TSMC',s:'semi',tv:'NYSE:TSM'},AVGO:{n:'博通 Broadcom',s:'semi',tv:'NASDAQ:AVGO'},
    MU:{n:'美光科技 Micron',s:'semi',tv:'NASDAQ:MU'},SNDK:{n:'闪迪 SanDisk',s:'semi',tv:'NASDAQ:SNDK'},
    SKHYNIX:{n:'SK海力士',s:'semi'},SKHY:{n:'SK海力士(BP)',s:'semi'},DRAM:{n:'存储芯片指数',s:'semi'},
    ASML:{n:'阿斯麦 ASML',s:'semi',tv:'NASDAQ:ASML'},ARM:{n:'ARM 控股',s:'semi',tv:'NASDAQ:ARM'},
    MRVL:{n:'迈威尔 Marvell',s:'semi',tv:'NASDAQ:MRVL'},SMCI:{n:'超微电脑 SMCI',s:'semi',tv:'NASDAQ:SMCI'},
    INTC:{n:'英特尔 Intel',s:'semi',tv:'NASDAQ:INTC'},QCOM:{n:'高通 Qualcomm',s:'semi',tv:'NASDAQ:QCOM'},
    AMAT:{n:'应用材料',s:'semi',tv:'NASDAQ:AMAT'},LRCX:{n:'泛林集团 Lam',s:'semi',tv:'NASDAQ:LRCX'},
    KLAC:{n:'科磊 KLA',s:'semi',tv:'NASDAQ:KLAC'},VRT:{n:'维谛技术 Vertiv',s:'semi',tv:'NYSE:VRT'},
    ANET:{n:'Arista 网络',s:'semi',tv:'NYSE:ANET'},CRWV:{n:'CoreWeave AI算力',s:'semi',tv:'NASDAQ:CRWV'},
    NBIS:{n:'Nebius AI云',s:'semi',tv:'NASDAQ:NBIS'},DELL:{n:'戴尔科技 Dell',s:'semi',tv:'NYSE:DELL'},
    WDC:{n:'西部数据 WDC',s:'semi',tv:'NASDAQ:WDC'},LITE:{n:'Lumentum 光通信',s:'semi',tv:'NASDAQ:LITE'},
    COHR:{n:'Coherent 光模块',s:'semi',tv:'NYSE:COHR'},AAOI:{n:'应用光电 AAOI',s:'semi',tv:'NASDAQ:AAOI'},
    ALAB:{n:'Astera Labs',s:'semi',tv:'NASDAQ:ALAB'},CRDO:{n:'Credo 高速互联',s:'semi',tv:'NASDAQ:CRDO'},
    SNPS:{n:'新思科技 Synopsys',s:'semi',tv:'NASDAQ:SNPS'},TER:{n:'泰瑞达 Teradyne',s:'semi',tv:'NASDAQ:TER'},
    TXN:{n:'德州仪器 TI',s:'semi',tv:'NASDAQ:TXN'},STM:{n:'意法半导体',s:'semi',tv:'NYSE:STM'},

    AAPL:{n:'苹果 Apple',s:'mag7',tv:'NASDAQ:AAPL'},MSFT:{n:'微软 Microsoft',s:'mag7',tv:'NASDAQ:MSFT'},
    GOOGL:{n:'谷歌 Alphabet',s:'mag7',tv:'NASDAQ:GOOGL'},AMZN:{n:'亚马逊 Amazon',s:'mag7',tv:'NASDAQ:AMZN'},
    META:{n:'Meta Platforms',s:'mag7',tv:'NASDAQ:META'},TSLA:{n:'特斯拉 Tesla',s:'mag7',tv:'NASDAQ:TSLA'},
    NFLX:{n:'奈飞 Netflix',s:'mag7',tv:'NASDAQ:NFLX'},ORCL:{n:'甲骨文 Oracle',s:'mag7',tv:'NYSE:ORCL'},
    PLTR:{n:'Palantir AI',s:'mag7',tv:'NASDAQ:PLTR'},CRM:{n:'Salesforce',s:'mag7',tv:'NYSE:CRM'},
    APP:{n:'AppLovin',s:'mag7',tv:'NASDAQ:APP'},PANW:{n:'Palo Alto 网安',s:'mag7',tv:'NASDAQ:PANW'},
    CRWD:{n:'CrowdStrike',s:'mag7',tv:'NASDAQ:CRWD'},SNOW:{n:'Snowflake',s:'mag7',tv:'NYSE:SNOW'},
    NOW:{n:'ServiceNow',s:'mag7',tv:'NYSE:NOW'},SHOP:{n:'Shopify',s:'mag7',tv:'NYSE:SHOP'},
    UBER:{n:'优步 Uber',s:'mag7',tv:'NYSE:UBER'},ADBE:{n:'Adobe',s:'mag7',tv:'NASDAQ:ADBE'},
    NET:{n:'Cloudflare',s:'mag7',tv:'NYSE:NET'},DDOG:{n:'Datadog',s:'mag7',tv:'NASDAQ:DDOG'},

    SPCX:{n:'SpaceX (未上市估值)',s:'preipo'},OPENAI:{n:'OpenAI (未上市估值)',s:'preipo'},
    UNITREE:{n:'宇树科技 Unitree',s:'preipo'},ZHIPU:{n:'智谱 AI',s:'preipo'},
    MINIMAX:{n:'MiniMax 稀宇科技',s:'preipo'},ANT:{n:'蚂蚁集团 Ant',s:'preipo'},
    MOONSHOT:{n:'月之暗面 Kimi',s:'preipo'},CXMT:{n:'长鑫存储 CXMT',s:'preipo'},
    OURA:{n:'Oura 智能指环',s:'preipo'},KSTR:{n:'Kstar 独角兽',s:'preipo'},

    SPY:{n:'标普500 ETF',s:'etf',tv:'AMEX:SPY'},QQQ:{n:'纳指100 ETF',s:'etf',tv:'NASDAQ:QQQ'},
    IWM:{n:'罗素2000 ETF',s:'etf',tv:'AMEX:IWM'},SOXL:{n:'3倍做多半导体 ETF',s:'etf',tv:'AMEX:SOXL'},
    SOXS:{n:'3倍做空半导体 ETF',s:'etf',tv:'AMEX:SOXS'},TQQQ:{n:'3倍做多纳指 ETF',s:'etf',tv:'NASDAQ:TQQQ'},
    SQQQ:{n:'3倍做空纳指 ETF',s:'etf',tv:'NASDAQ:SQQQ'},SMH:{n:'VanEck 半导体 ETF',s:'etf',tv:'NASDAQ:SMH'},
    SOXX:{n:'iShares 半导体 ETF',s:'etf',tv:'NASDAQ:SOXX'},NVDL:{n:'2倍做多英伟达 ETF',s:'etf',tv:'NASDAQ:NVDL'},
    TSLL:{n:'2倍做多特斯拉 ETF',s:'etf',tv:'NASDAQ:TSLL'},MSTU:{n:'2倍做多MSTR ETF',s:'etf'},
    AMDL:{n:'2倍做多AMD ETF',s:'etf'},MUU:{n:'2倍做多美光 ETF',s:'etf'},MVLL:{n:'2倍做多MRVL ETF',s:'etf'},
    SNXX:{n:'杠杆存储芯片 ETF',s:'etf'},KORU:{n:'3倍做多韩国 ETF',s:'etf',tv:'AMEX:KORU'},
    EWY:{n:'韩国 MSCI ETF',s:'etf',tv:'AMEX:EWY'},EWJ:{n:'日本 MSCI ETF',s:'etf',tv:'AMEX:EWJ'},
    EWZ:{n:'巴西 MSCI ETF',s:'etf',tv:'AMEX:EWZ'},UVXY:{n:'1.5倍恐慌指数 VIX',s:'etf',tv:'AMEX:UVXY'},
    TMF:{n:'3倍做多20年美债',s:'etf',tv:'AMEX:TMF'},TBT:{n:'2倍做空20年美债',s:'etf',tv:'AMEX:TBT'},
    GDX:{n:'黄金矿业 ETF',s:'etf',tv:'AMEX:GDX'},XLE:{n:'美股能源 ETF',s:'etf',tv:'AMEX:XLE'},
    XBI:{n:'生物科技 ETF',s:'etf',tv:'AMEX:XBI'},URNM:{n:'铀矿核能 ETF',s:'etf',tv:'AMEX:URNM'},
    IGV:{n:'北美软件 ETF',s:'etf',tv:'AMEX:IGV'},TZA:{n:'3倍做空小盘股',s:'etf',tv:'AMEX:TZA'},
    CSOPSKHYNIX2L:{n:'南方2倍做多海力士',s:'etf'},CSOPSAMSUNG2L:{n:'南方2倍做多三星',s:'etf'},
    KODEX200:{n:'韩国 KOSPI200 ETF',s:'etf'},

    MSTR:{n:'Strategy (微策略)',s:'crypto_eq',tv:'NASDAQ:MSTR'},COIN:{n:'Coinbase 交易所',s:'crypto_eq',tv:'NASDAQ:COIN'},
    CRCL:{n:'Circle (USDC发行方)',s:'crypto_eq',tv:'NYSE:CRCL'},HOOD:{n:'Robinhood 券商',s:'crypto_eq',tv:'NASDAQ:HOOD'},
    MARA:{n:'MARA 比特币矿企',s:'crypto_eq',tv:'NASDAQ:MARA'},IREN:{n:'IREN 算力矿企',s:'crypto_eq',tv:'NASDAQ:IREN'},
    HUT:{n:'Hut 8 矿企',s:'crypto_eq',tv:'NASDAQ:HUT'},IBIT:{n:'贝莱德比特币 ETF',s:'crypto_eq',tv:'NASDAQ:IBIT'},
    BITO:{n:'ProShares 比特币ETF',s:'crypto_eq',tv:'AMEX:BITO'},BMNR:{n:'Bitmine Immersion',s:'crypto_eq'},
    APLD:{n:'Applied Digital',s:'crypto_eq',tv:'NASDAQ:APLD'},

    BABA:{n:'阿里巴巴',s:'asia',tv:'NYSE:BABA'},PDD:{n:'拼多多 Temu',s:'asia',tv:'NASDAQ:PDD'},
    NIO:{n:'蔚来汽车',s:'asia',tv:'NYSE:NIO'},BYD:{n:'比亚迪股份',s:'asia'},
    HK0700:{n:'腾讯控股 (港)',s:'asia',tv:'HKEX:700'},TENCENT:{n:'腾讯 ADR',s:'asia'},
    HK1810:{n:'小米集团 (港)',s:'asia',tv:'HKEX:1810'},HK0992:{n:'联想集团 (港)',s:'asia',tv:'HKEX:992'},
    MEITUAN:{n:'美团 (港)',s:'asia'},KUAISHOU:{n:'快手 (港)',s:'asia'},POPMART:{n:'泡泡玛特',s:'asia'},
    ZHONGJI:{n:'中际旭创 (光模块)',s:'asia'},GIGADEV:{n:'兆易创新 (存储)',s:'asia'},
    SAMSUNG:{n:'三星电子',s:'asia'},SAMSUNGEM:{n:'三星电机',s:'asia'},HYUNDAI:{n:'现代汽车',s:'asia'},
    LGELECTRONICS:{n:'LG 电子',s:'asia'},NAVER:{n:'NAVER (韩)',s:'asia'},SONY:{n:'索尼集团 Sony',s:'asia',tv:'NYSE:SONY'},
    HANMI:{n:'韩美半导体',s:'asia'},

    XAU:{n:'现货黄金 Gold',s:'macro',tv:'OANDA:XAUUSD'},XAG:{n:'现货白银 Silver',s:'macro',tv:'OANDA:XAGUSD'},
    XPT:{n:'现货铂金 Platinum',s:'macro'},XPD:{n:'现货钯金 Palladium',s:'macro'},
    COPPER:{n:'高级铜 Copper',s:'macro'},CL:{n:'WTI 美原油',s:'macro',tv:'NYMEX:CL1!'},
    BZ:{n:'布伦特原油 Brent',s:'macro'},NATGAS:{n:'美国天然气',s:'macro'},
    USDBRL:{n:'美元/巴西雷亚尔',s:'macro'},USDEX:{n:'美元指数合约',s:'macro'},

    COST:{n:'好市多 Costco',s:'us_other',tv:'NASDAQ:COST'},LLY:{n:'礼来制药 Eli Lilly',s:'us_other',tv:'NYSE:LLY'},
    BRKB:{n:'伯克希尔哈撒韦 B',s:'us_other',tv:'NYSE:BRK.B'},JPM:{n:'摩根大通 JPMorgan',s:'us_other',tv:'NYSE:JPM'},
    GS:{n:'高盛集团 Goldman',s:'us_other',tv:'NYSE:GS'},V:{n:'Visa 维萨',s:'us_other',tv:'NYSE:V'},
    WMT:{n:'沃尔玛 Walmart',s:'us_other',tv:'NYSE:WMT'},UNH:{n:'联合健康 UNH',s:'us_other',tv:'NYSE:UNH'},
    CAT:{n:'卡特彼勒 Caterpillar',s:'us_other',tv:'NYSE:CAT'},GEV:{n:'GE Vernova 电力',s:'us_other',tv:'NYSE:GEV'},
    CEG:{n:'Constellation 核电',s:'us_other',tv:'NASDAQ:CEG'},VST:{n:'Vistra 电力',s:'us_other',tv:'NYSE:VST'},
    OKLO:{n:'Oklo 小型核反应堆',s:'us_other',tv:'NYSE:OKLO'},RKLB:{n:'Rocket Lab 火箭实验室',s:'us_other',tv:'NASDAQ:RKLB'},
    ASTS:{n:'AST 太空移动通信',s:'us_other',tv:'NASDAQ:ASTS'},IONQ:{n:'IonQ 量子计算',s:'us_other',tv:'NYSE:IONQ'},
    GME:{n:'游戏驿站 GameStop',s:'us_other',tv:'NYSE:GME'},AMC:{n:'AMC 院线',s:'us_other',tv:'NYSE:AMC'},
    DJT:{n:'特朗普媒体科技',s:'us_other',tv:'NASDAQ:DJT'},RDDT:{n:'Reddit 社区',s:'us_other',tv:'NYSE:RDDT'},
    HIMS:{n:'Hims & Hers 医疗',s:'us_other',tv:'NYSE:HIMS'},MRNA:{n:'Moderna 生物',s:'us_other',tv:'NASDAQ:MRNA'},
    NKE:{n:'耐克 Nike',s:'us_other',tv:'NYSE:NKE'},DIS:{n:'迪士尼 Disney',s:'us_other',tv:'NYSE:DIS'},
    MCD:{n:'麦当劳 McDonald',s:'us_other',tv:'NYSE:MCD'},KO:{n:'可口可乐 Coca-Cola',s:'us_other',tv:'NYSE:KO'},
    BAC:{n:'美国银行 BofA',s:'us_other',tv:'NYSE:BAC'},IBKR:{n:'盈透证券 IBKR',s:'us_other',tv:'NASDAQ:IBKR'},
    XOM:{n:'埃克森美孚',s:'us_other',tv:'NYSE:XOM'},OXY:{n:'西方石油 Occidental',s:'us_other',tv:'NYSE:OXY'},
    ETN:{n:'伊顿电气 Eaton',s:'us_other',tv:'NYSE:ETN'},TTWO:{n:'Take-Two (GTA6)',s:'us_other',tv:'NASDAQ:TTWO'}
  };

  const SECTORS=[
    ['all','全部标的'],
    ['semi','🔥 AI与半导体'],
    ['mag7','🏛 科技巨头'],
    ['etf','📊 指数与杠杆ETF'],
    ['preipo','🦄 Pre-IPO独角兽'],
    ['crypto_eq','🪙 加密概念股'],
    ['asia','🌏 港韩中概亚太'],
    ['macro','🛢 商品黄金外汇'],
    ['us_other','🇺🇸 美股精选']
  ];
  const SECTOR_LABEL=Object.fromEntries(SECTORS);

  const STOCK={
    rows:[],loading:false,err:null,q:'',sector:'all',preset:'all',
    sort:'vol',dir:-1,bench:'SPYUSDT',snapT:0,liveAt:0,timer:null,dynamicSet:new Set()
  };

  function isTradFiSymbol(sym){
    const s=String(sym||'').toUpperCase();
    if(TRADFI_KNOWN.has(s)||STOCK.dynamicSet.has(s))return true;
    if(typeof S!=='undefined'&&S.stockSet&&S.stockSet.has(s))return true;
    return false;
  }

  function registerTradFiSymbols(list){
    for(const s of (list||[]))if(s)STOCK.dynamicSet.add(String(s).toUpperCase());
  }

  function stockMetaOf(sym){
    const base=String(sym||'').toUpperCase().replace(/USDT$/,'');
    if(META[base])return {base,...META[base],sectorName:SECTOR_LABEL[META[base].s]||'美股精选'};
    let s='us_other';
    if(/^HK\d+/.test(base)||/SAMSUNG|HYUNDAI|KODEX|CSOP/.test(base))s='asia';
    else if(/^(XAU|XAG|XPT|XPD|CL|BZ|NATGAS|USD)/.test(base))s='macro';
    else if(/(2L|3L|ETF|QQQ|SPY|EW[A-Z]|SOX)/.test(base))s='etf';
    return {base,n:base,s,sectorName:SECTOR_LABEL[s]||'美股精选'};
  }

  /* 纽约美东时间（自动适配夏令时 EDT / 冬令时 EST）盘前/盘中/盘后/周末状态计算 */
  function stockMarketSession(nowMs){
    nowMs=nowMs||Date.now();
    try{
      const parts=new Intl.DateTimeFormat('en-US',{
        timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false
      }).formatToParts(new Date(nowMs));
      const get=t=>(parts.find(p=>p.type===t)||{}).value||'';
      const wd=get('weekday');
      const hh=parseInt(get('hour'),10)%24,mm=parseInt(get('minute'),10);
      const mins=hh*60+mm;
      const clock=`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} ET`;
      const isWeekend=(wd==='Sat'||wd==='Sun');
      if(isWeekend){
        return {code:'weekend',cls:'warn',shortBadge:`🟣 美股周末休市 (${clock})`,badge:'🟣 美股周末休市 · 币安 24/7 合约独市定价',clock,
          tip:'底层美股现货周末停盘，币安合约连续交易；重点关注「标记基差%」偏离与周一美股盘前跳空收敛机会。'};
      }
      if(mins>=570&&mins<960){
        const left=960-mins;
        return {code:'regular',cls:'ok',shortBadge:`🟢 美股盘中 (${clock})`,badge:`🟢 美股盘中交易 (${clock} · 距收盘 ${Math.floor(left/60)}h${left%60}m)`,clock,
          tip:'纳斯达克/纽交所现货连续撮合中，套利做市活跃，合约标记基差通常最窄。'};
      }
      if(mins>=240&&mins<570){
        const left=570-mins;
        return {code:'pre',cls:'warn',shortBadge:`🟡 美股盘前 (${clock})`,badge:`🟡 美股盘前时段 (${clock} · 距开盘 ${Math.floor(left/60)}h${left%60}m)`,clock,
          tip:'盘前宏观数据与财报发布窗口，21:30/22:30(北京时间)开盘首 15m 波动率与成交量显著放大。'};
      }
      if(mins>=960&&mins<1200){
        const left=1200-mins;
        return {code:'after',cls:'warn',shortBadge:`🟡 美股盘后 (${clock})`,badge:`🟡 美股盘后时段 (${clock} · 距夜盘 ${Math.floor(left/60)}h${left%60}m)`,clock,
          tip:'巨头财报常在盘后前 30 分钟发布，注意流动性变薄时的插针与 OI 突变。'};
      }
      const toPre=mins<240?(240-mins):(1440-mins+240);
      return {code:'overnight',cls:'warn',shortBadge:`🌙 美股夜盘 (${clock})`,badge:`🌙 美股夜盘休市 (${clock} · 距盘前 ${Math.floor(toPre/60)}h${toPre%60}m)`,clock,
        tip:'亚欧时段由币安 24/7 合约资金与亚太芯片股(三星/海力士/港股)联动定价，可观察基差溢价方向。'};
    }catch(e){
      return {code:'unknown',cls:'',badge:'币安 24/7 股票合约连续市场',clock:'',tip:''};
    }
  }

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct=(v,d=2)=>(v==null||!isFinite(v))?'—':(v>=0?'+':'')+v.toFixed(d)+'%';

  async function stockLoad(force){
    if(STOCK.loading)return;
    if(STOCK.rows.length&&!force&&Date.now()-STOCK.liveAt<30000){stockRender();return}
    STOCK.loading=true;
    if(!STOCK.rows.length)stockRender();
    try{
      /* 1. 先读 cap-snapshot.json 获取全部 245 个标的的 OI 基准，同时并发拉实时 24h 行情与实时标记价/费率/基差 */
      const [snapRes,tickArr,premArr]=await Promise.all([
        fetch('cap-snapshot.json').then(r=>r.ok?r.json():null).catch(()=>null),
        jget(API+'/fapi/v1/ticker/24hr',25000).catch(()=>null),
        jget(API+'/fapi/v1/premiumIndex',25000).catch(()=>null)
      ]);
      const snapMap=new Map();
      if(snapRes&&Array.isArray(snapRes.coins)){
        STOCK.snapT=snapRes.generatedAt||0;
        for(const c of snapRes.coins){
          if(c.ct==='TRADIFI_PERPETUAL'||isTradFiSymbol(c.s))snapMap.set(c.s,c);
        }
      }
      const tickMap=new Map();
      if(Array.isArray(tickArr)){
        for(const t of tickArr){
          if(isTradFiSymbol(t.symbol))tickMap.set(t.symbol,{px:+t.lastPrice,chg:+t.priceChangePercent,vol:+t.quoteVolume});
        }
      }
      const premMap=new Map();
      if(Array.isArray(premArr)){
        for(const p of premArr){
          if(isTradFiSymbol(p.symbol)){
            const mk=+p.markPrice,ix=+p.indexPrice;
            premMap.set(p.symbol,{
              mark:mk>0?mk:null,index:ix>0?ix:null,
              fr:isFinite(+p.lastFundingRate)?+p.lastFundingRate:null,
              basis:(mk>0&&ix>0)?(mk/ix-1)*100:null,
              next:+p.nextFundingTime||null
            });
          }
        }
      }
      const allSyms=new Set([...TRADFI_KNOWN,...STOCK.dynamicSet,...snapMap.keys(),...tickMap.keys()]);
      const rows=[];
      for(const sym of allSyms){
        const sn=snapMap.get(sym),tk=tickMap.get(sym),pr=premMap.get(sym);
        const px=pr?.mark??tk?.px??sn?.p??null;
        const chg=tk?.chg??sn?.c??null;
        const vol=tk?.vol??sn?.v??null;
        if(!(px>0)&&!(vol>0))continue;
        const oi=(typeof S!=='undefined'&&S.oi&&S.oi.has(sym))?S.oi.get(sym):(sn?.oi??null);
        const oiv=(oi!=null&&px>0)?oi*px:null;
        const turnRatio=(oiv!=null&&vol>0)?(oiv/vol*100):null;
        const m=stockMetaOf(sym);
        rows.push({
          sym,base:m.base,name:m.n,sector:m.s,sectorName:m.sectorName,tv:m.tv||null,
          px,chg,vol,oi,oiv,turnRatio,
          fr:pr?.fr??null,basis:pr?.basis??null,index:pr?.index??null,next:pr?.next??null
        });
      }
      if(!rows.length)throw new Error('未获取到股票合约行情');
      STOCK.rows=rows;STOCK.err=null;STOCK.liveAt=Date.now();
    }catch(e){
      STOCK.err='股票行情加载失败：'+(e.message||e);
    }finally{
      STOCK.loading=false;
      stockRender();
    }
  }

  /* 按需刷新前 40 大活跃股票的实时 OI（不阻塞首屏） */
  async function stockRefreshLiveOi(){
    if(!STOCK.rows.length||STOCK.oiRefreshing)return;
    STOCK.oiRefreshing=true;
    const btn=$('#skOiRefresh');if(btn){btn.disabled=true;btn.textContent='刷新实时OI…'}
    try{
      const top=[...STOCK.rows].sort((a,b)=>(b.vol||0)-(a.vol||0)).slice(0,40);
      await pool(top,8,async r=>{
        try{
          const v=await loadOiOne(r.sym);
          if(v>0){
            if(typeof S!=='undefined'&&S.oi)S.oi.set(r.sym,v);
            r.oi=v;if(r.px>0)r.oiv=v*r.px;
            if(r.oiv!=null&&r.vol>0)r.turnRatio=r.oiv/r.vol*100;
          }
        }catch(e){}
      });
      toast('已更新前 40 大成交股票合约的实时持仓量');
    }finally{
      STOCK.oiRefreshing=false;
      stockRender();
    }
  }

  function stockBenchRow(sym){
    return STOCK.rows.find(r=>r.sym===sym)||null;
  }

  function stockFilterList(){
    const q=STOCK.q.trim().toUpperCase();
    const spyChg=stockBenchRow('SPYUSDT')?.chg??0;
    const qqqChg=stockBenchRow('QQQUSDT')?.chg??0;
    const benchMax=Math.max(spyChg,qqqChg);
    const benchCur=stockBenchRow(STOCK.bench)?.chg??0;
    return STOCK.rows.filter(r=>{
      if(STOCK.sector!=='all'&&r.sector!==STOCK.sector)return false;
      if(q&&!r.sym.includes(q)&&!r.name.toUpperCase().includes(q))return false;
      if(STOCK.preset==='alpha')return r.chg!=null&&r.chg>benchMax&&(r.vol||0)>=5e6;
      if(STOCK.preset==='arb')return (r.basis!=null&&Math.abs(r.basis)>=0.12)||(r.fr!=null&&Math.abs(r.fr)>=0.0002);
      if(STOCK.preset==='heavy')return (r.oiv||0)>=5e6&&(r.turnRatio||0)>=20;
      return true;
    }).map(r=>({...r,excess:r.chg!=null?r.chg-benchCur:null}));
  }

  function stockRender(){
    const host=$('#stockHost');if(!host)return;
    if(STOCK.loading&&!STOCK.rows.length){
      host.innerHTML='<p class="muted hint"><span class="spin"></span> 正在加载币安股票、ETF、独角兽与商品永续合约…</p>';
      return;
    }
    if(STOCK.err&&!STOCK.rows.length){
      host.innerHTML='<p class="muted hint">'+esc(STOCK.err)+' · <a href="javascript:void(0)" id="skRetry">重试</a></p>';
      const rt=$('#skRetry');if(rt)rt.onclick=()=>stockLoad(true);
      return;
    }
    const sess=stockMarketSession();
    const totalVol=STOCK.rows.reduce((a,r)=>a+(r.vol||0),0);
    const totalOi=STOCK.rows.reduce((a,r)=>a+(r.oiv||0),0);

    /* 宏观基准锚点条 */
    const benches=[
      ['SPYUSDT','标普500 SPY'],['QQQUSDT','纳指100 QQQ'],['SOXLUSDT','3x半导体 SOXL'],
      ['NVDAUSDT','英伟达 NVDA'],['SPCXUSDT','SpaceX(未上市)'],['XAUUSDT','现货黄金 XAU']
    ];
    const benchHtml=benches.map(([sym,lbl])=>{
      const b=stockBenchRow(sym);
      const isBench=(sym==='SPYUSDT'||sym==='QQQUSDT')&&STOCK.bench===sym;
      return `<div class="sk-bench${isBench?' on':''}" data-sk-b="${sym}">`+
        `<div class="row" style="justify-content:space-between;gap:4px"><span class="k">${lbl}</span>`+
        `<button type="button" class="sk-go" data-sk-jump="${sym}" title="打开作战室">作战 ›</button></div>`+
        `<b>${b?.px!=null?fPrice(b.px):'—'} <em class="${clsP(b?.chg)}">${b?.chg!=null?pct(b.chg):''}</em></b>`+
        `<small>成交 ${b?.vol!=null?'$'+fC(b.vol):'—'} · OI ${b?.oiv!=null?'$'+fC(b.oiv):'—'}</small></div>`;
    }).join('');

    /* 板块热力切换胶囊 */
    const secHtml=SECTORS.map(([k,lbl])=>{
      const sub=k==='all'?STOCK.rows:STOCK.rows.filter(r=>r.sector===k);
      const active=sub.filter(r=>r.chg!=null&&(r.vol||0)>=1e6);
      const avg=active.length?active.reduce((a,r)=>a+r.chg,0)/active.length:null;
      return `<button type="button" class="${STOCK.sector===k?'on':''}" data-sk-sec="${k}">${lbl} <em class="${clsP(avg)}" style="font-style:normal;font-size:10.5px">${k==='all'?sub.length:(avg!=null?pct(avg,1):sub.length)}</em></button>`;
    }).join('');

    /* 四大股票实战筛选预设 */
    const spyChg=stockBenchRow('SPYUSDT')?.chg??0,qqqChg=stockBenchRow('QQQUSDT')?.chg??0,bMax=Math.max(spyChg,qqqChg);
    const cntAlpha=STOCK.rows.filter(r=>r.chg!=null&&r.chg>bMax&&(r.vol||0)>=5e6).length;
    const cntArb=STOCK.rows.filter(r=>(r.basis!=null&&Math.abs(r.basis)>=0.12)||(r.fr!=null&&Math.abs(r.fr)>=0.0002)).length;
    const cntHeavy=STOCK.rows.filter(r=>(r.oiv||0)>=5e6&&(r.turnRatio||0)>=20).length;
    const presets=[
      ['all','全部合约',STOCK.rows.length,'全市场股票/ETF/独角兽/商品'],
      ['alpha','🚀 强于美股大盘',cntAlpha,'24h% 跑赢 SPY与QQQ · 成交≥5M'],
      ['arb','⚖️ 休市基差/资费偏离',cntArb,'|标记基差|≥0.12% 或 |费率|≥0.02%'],
      ['heavy','🐋 高持仓隔夜沉淀',cntHeavy,'OI名义≥5M 且 OI/24h成交≥20%']
    ];
    const presetHtml=presets.map(([k,t,n,d])=>
      `<button type="button" class="res-card${STOCK.preset===k?' on':''}" data-sk-pre="${k}"><b>${t}<em>${n}</em></b><span>${d}</span></button>`
    ).join('');

    const list=stockFilterList();
    const sk=STOCK.sort,sd=STOCK.dir;
    const valOf=r=>{
      if(sk==='px')return r.px;if(sk==='chg')return r.chg;if(sk==='excess')return r.excess;
      if(sk==='oiv')return r.oiv;if(sk==='vol')return r.vol;if(sk==='turn')return r.turnRatio;
      if(sk==='basis')return r.basis!=null?Math.abs(r.basis):null;if(sk==='fr')return r.fr;
      return r.vol;
    };
    list.sort((a,b)=>{
      if(sk==='sym')return sd*a.sym.localeCompare(b.sym);
      const va=valOf(a),vb=valOf(b);
      if(va==null&&vb==null)return 0;if(va==null)return 1;if(vb==null)return -1;
      return sd*(va-vb);
    });
    const shown=list.slice(0,120);
    const benchName=STOCK.bench==='QQQUSDT'?'QQQ':'SPY';

    const sortTh=(k,lbl)=>`<th data-sk-sort="${k}" class="${sk===k?(sd<0?'sd':'sa'):''}">${lbl}</th>`;
    const rowsHtml=shown.map((r,i)=>{
      const basisCls=r.basis==null?'':(Math.abs(r.basis)>=0.15?(r.basis>0?'up':'down'):'mut');
      const frCls=r.fr==null?'':(r.fr>=0.0002?'up':(r.fr<=-0.0001?'down':''));
      return `<tr>`+
        `<td class="muted">${i+1}</td>`+
        `<td class="ta-l sk-sticky"><a href="javascript:void(0)" data-sk-sym="${esc(r.sym)}"><b>${esc(r.base)}</b></a>`+
          `<span class="sk-sub">${esc(r.name)} · <i>${esc(r.sectorName.replace(/^[^\s]+\s/,''))}</i></span></td>`+
        `<td>${fPrice(r.px)}</td>`+
        `<td class="${clsP(r.chg)}">${pct(r.chg)}</td>`+
        `<td class="${clsP(r.excess)}">${pct(r.excess)}</td>`+
        `<td>${r.oiv!=null?'$'+fC(r.oiv):'—'}</td>`+
        `<td>${r.vol!=null?'$'+fC(r.vol):'—'}</td>`+
        `<td class="${(r.turnRatio||0)>=25?'up':'mut'}">${r.turnRatio!=null?r.turnRatio.toFixed(1)+'%':'—'}</td>`+
        `<td class="${basisCls}">${r.basis!=null?pct(r.basis,3):'—'}</td>`+
        `<td class="${frCls}">${r.fr!=null?(r.fr*100).toFixed(4)+'%':'—'}</td>`+
      `</tr>`;
    }).join('')||`<tr><td colspan="10" style="text-align:center;color:var(--dim);padding:20px">当前板块/预设下无匹配标的</td></tr>`;

    host.innerHTML=
      `<div class="sk-session ${sess.cls}">`+
        `<div class="row" style="justify-content:space-between;gap:8px"><b>${sess.badge}</b>`+
        `<span class="mut">全市场 ${STOCK.rows.length} 标的 · 24h总成交 <b style="color:var(--txt)">$${fC(totalVol)}</b> · 总OI <b style="color:var(--txt)">$${fC(totalOi)}</b></span></div>`+
        `<p>${sess.tip}</p>`+
      `</div>`+
      `<div class="sk-benches">${benchHtml}</div>`+
      `<div class="res-presets">${presetHtml}</div>`+
      `<div class="seg sk-sectors" style="margin-bottom:8px">${secHtml}</div>`+
      `<div class="row" style="margin-bottom:8px;gap:6px">`+
        `<input id="skSearch" placeholder="搜索代码或中文名，如 NVDA / 英伟达 / SpaceX / 黄金" value="${esc(STOCK.q)}" style="flex:1 1 200px;background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:14px;color:var(--txt);outline:none">`+
        `<div class="seg"><button type="button" data-sk-bm="SPYUSDT" class="${STOCK.bench==='SPYUSDT'?'on':''}">基准 SPY</button><button type="button" data-sk-bm="QQQUSDT" class="${STOCK.bench==='QQQUSDT'?'on':''}">基准 QQQ</button></div>`+
        `<button type="button" class="btn mini" id="skOiRefresh">↻ 实时OI(Top40)</button>`+
        `<button type="button" class="btn mini pri" id="skReload">↻ 刷新行情</button>`+
      `</div>`+
      `<div class="tblwrap"><table class="tbl sk-tbl"><thead><tr>`+
        `<th>#</th>${sortTh('sym','代码 / 标的')}${sortTh('px','标记价')}${sortTh('chg','24h%')}${sortTh('excess','较'+benchName+'超额')}`+
        `${sortTh('oiv','OI 名义')}${sortTh('vol','24h 成交额')}${sortTh('turn','OI/成交比')}${sortTh('basis','标记基差%')}${sortTh('fr','实时费率')}`+
      `</tr></thead><tbody>${rowsHtml}</tbody></table></div>`+
      `<p class="muted hint" style="margin-top:6px">口径说明：数据来自 Binance 传统金融永续合约（TRADIFI_PERPETUAL，USDT结算，最高10x–20x，24/7连续交易）。标记基差=(合约标记价/底层指数价−1)；已严格隔离加密同名代币市值，避免假市值占比。点击任意标的进入「单币作战室」查看 15m/1h SMC 结构、多空比与以损定量算仓。</p>`;

    /* 绑定事件 */
    const sq=$('#skSearch');
    if(sq)sq.oninput=()=>{
      STOCK.q=sq.value;stockRender();
      const sq2=$('#skSearch');if(sq2){sq2.focus();sq2.setSelectionRange(sq2.value.length,sq2.value.length)}
    };
    host.querySelectorAll('[data-sk-sec]').forEach(b=>b.onclick=()=>{STOCK.sector=b.dataset.skSec;stockRender()});
    host.querySelectorAll('[data-sk-pre]').forEach(b=>b.onclick=()=>{STOCK.preset=b.dataset.skPre;stockRender()});
    host.querySelectorAll('[data-sk-bm]').forEach(b=>b.onclick=()=>{STOCK.bench=b.dataset.skBm;stockRender()});
    host.querySelectorAll('[data-sk-b]').forEach(d=>d.onclick=e=>{
      if(e.target.closest('[data-sk-jump]'))return;
      const s=d.dataset.skB;
      if(s==='SPYUSDT'||s==='QQQUSDT'){STOCK.bench=s;stockRender()}
      else{setJumpContext(shown.map(x=>x.sym),'股票合约榜');jumpSym(s)}
    });
    host.querySelectorAll('[data-sk-jump]').forEach(b=>b.onclick=e=>{
      e.stopPropagation();
      setJumpContext(shown.map(x=>x.sym),'股票核心标的');
      jumpSym(b.dataset.skJump);
    });
    host.querySelectorAll('th[data-sk-sort]').forEach(th=>th.onclick=()=>{
      const k=th.dataset.skSort;
      if(STOCK.sort===k)STOCK.dir*=-1;else{STOCK.sort=k;STOCK.dir=-1}
      stockRender();
    });
    host.querySelectorAll('[data-sk-sym]').forEach(a=>a.onclick=e=>{
      e.preventDefault();
      if(typeof setJumpContext==='function')setJumpContext(shown.map(x=>x.sym),'股票合约榜');
      if(typeof jumpSym==='function')jumpSym(a.dataset.skSym);
    });
    const rl=$('#skReload');if(rl)rl.onclick=()=>stockLoad(true);
    const orf=$('#skOiRefresh');if(orf)orf.onclick=()=>stockRefreshLiveOi();
  }

  function stockInit(){
    stockLoad(false);
    if(!STOCK.timer){
      STOCK.timer=setInterval(()=>{
        if(typeof Layout!=='undefined'&&Layout.current==='stock'&&!document.hidden)stockLoad(true);
      },30000);
    }
  }

  root.STOCK=STOCK;
  root.isTradFiSymbol=isTradFiSymbol;
  root.registerTradFiSymbols=registerTradFiSymbols;
  root.stockMetaOf=stockMetaOf;
  root.stockMarketSession=stockMarketSession;
  root.stockInit=stockInit;
  root.stockLoad=stockLoad;
})(typeof globalThis!=='undefined'?globalThis:this);
