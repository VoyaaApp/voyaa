function t(r){return r<1e3?r.toString():r<1e4?(r/1e3).toFixed(1).replace(/\.0$/,"")+"k":r<1e6?Math.floor(r/1e3)+"k":(r/1e6).toFixed(1).replace(/\.0$/,"")+"M"}export{t as a};
