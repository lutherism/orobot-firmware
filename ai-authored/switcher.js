const { exec } = require('child_process');
const wpa = new WpaCtrl();

// Switch to Client Mode
async function switchToClient() {
  exec('sudo systemctl stop hostapd dnsmasq nodogsplash');
  exec('sudo wpa_supplicant -B -i wlan0 -c /etc/wpa_supplicant/wpa_supplicant.conf');
  await wpa.connectToNetwork(savedNetworkId);
  exec('sudo dhclient wlan0');  // If needed
}

// Switch to AP Mode (fallback)
async function switchToAP() {
  exec('sudo systemctl stop wpa_supplicant');
  exec('sudo ip link set wlan0 down && sudo ip addr flush dev wlan0 && sudo ip addr add 192.168.50.1/24 dev wlan0 && sudo ip link set wlan0 up');
  exec('sudo systemctl start dnsmasq hostapd nodogsplash');
}
