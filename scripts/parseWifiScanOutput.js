const lineDelineator = '\n                    ';

function parseWifiScanOutput(output) {
  let rawNetworks, uniqueNetworks;
  if (output.macWifi) {
    const uniqueTable = {};
    rawNetworks = output.macWifi
      .slice(1)
      .map(node => {
        const cols = new RegExp("\\s*([a-zA-Z0-9-_\\s]*)\\s*([a-fA-F0-9]{2}:[a-fA-F0-9]{2}:[a-fA-F0-9]{2}:[a-fA-F0-9]{2}:[a-fA-F0-9]{2}:[a-fA-F0-9]{2})\\s*([-|+]{1}[0-9]*)\\s*([0-9]*,*[-|+]*[0-9]*)\\s*([Y|N]{1})\\s*([A-Z-]*)\\s*(.*)")
          .exec(node.trim());
        console.log(cols);
        if (!cols) {
          return null;
        }
        return {
          ssid: cols[1],
          mac: cols[2],
          security: cols[7]
        }
      });
    uniqueNetworks = rawNetworks
      .filter(x => {
        if (!x) {
          return null;
        }
        if (uniqueTable[x.ssid]) {
          return false;
        }
        uniqueTable[x.ssid] = true;
        return x.ssid.length > 0
      });
  } else {
    const uniqueTable = {};
    rawNetworks = output.wifi
      .slice(1)
      .map(node => {
        return node.split(lineDelineator).reduce((a, line) => {
          if (line.indexOf('ESSID') === 0) {
            a['ssid'] = line.slice(7, -1);
          }
          if (line.indexOf('Address:') > -1) {
            a['mac'] = line.slice(15);
          }
          if (line.indexOf('IE: IEEE') === 0) {
            a['security'] = line.slice(15);
          }
          return a;
        }, {});
      });
    uniqueNetworks = rawNetworks
      .filter(x => {
        if (uniqueTable[x.ssid]) {
          return false;
        }
        uniqueTable[x.ssid] = true;
        return x.ssid.length > 0
      });
  }
  return {rawNetworks, uniqueNetworks};
}

module.exports = parseWifiScanOutput;
