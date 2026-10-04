/* Exact chain/address adapters. Native assets are not guessed ERC20 contracts. */
(function(root){'use strict';
const E={bsc:[56,'https://bscscan.com/token/'],ethereum:[1,'https://etherscan.io/token/'],base:[8453,'https://basescan.org/token/'],arbitrum:[42161,'https://arbiscan.io/token/'],optimism:[10,'https://optimistic.etherscan.io/token/'],polygon:[137,'https://polygonscan.com/token/'],avalanche:[43114,'https://snowtrace.io/token/'],linea:[59144,'https://lineascan.build/token/']};
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function sol(v){if(typeof v!=='string'||v.length<32||v.length>44)return false;let n=0n;for(const x of v){const d=alphabet.indexOf(x);if(d<0)return false;n=n*58n+BigInt(d)}let bytes=0;while(n){bytes++;n>>=8n}let zeros=0;while(v[zeros]==='1')zeros++;return bytes+zeros===32}
function valid(t){if(!t||typeof t.address!=='string')return false;if(E[t.chain])return t.chainId===E[t.chain][0]&&/^0x[0-9a-f]{40}$/i.test(t.address);if(t.chain==='solana')return t.chainId==='CT_501'&&sol(t.address);if(t.chain==='sui')return t.chainId==='CT_784'&&/^0x[0-9a-f]{1,64}::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/.test(t.address);return false}
const norm=(chain,address)=>E[chain]?String(address).toLowerCase():String(address);
function identity(a,b){return !!a&&!!b&&a.symbol===b.symbol&&a.chain===b.chain&&a.chainId===b.chainId&&valid(a)&&valid(b)&&norm(a.chain,a.address)===norm(b.chain,b.address)}
function explorer(t){if(!valid(t))return '';if(E[t.chain])return E[t.chain][1]+encodeURIComponent(t.address);if(t.chain==='solana')return 'https://solscan.io/token/'+encodeURIComponent(t.address);if(t.chain==='sui')return 'https://suivision.xyz/coin/'+encodeURIComponent(t.address);return ''}
const C={E,sol,valid,norm,identity,explorer};if(typeof module!=='undefined'&&module.exports)module.exports=C;else root.ChainAdapters=C;
})(globalThis);
