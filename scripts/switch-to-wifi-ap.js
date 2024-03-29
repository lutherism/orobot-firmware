const {spawn} = require('child_process');
const fs = require('fs');
const {singleton,
  upsertDeviceData,
  refreshDeviceData} = require('./device-data.js');

const wpaConfPath = "/etc/wpa_supplicant/wpa_supplicant.conf";
const dnsConfPath = "/etc/dnsmasq.conf";
const hostsPath = "/etc/hosts";
const hostAPDPath = "/etc/hostapd/hostapd.conf";
const dhcpPath = "/etc/dhcpcd.conf";
const nginxPath = "/etc/nginx/sites-enabled/default";

const createWPAConf = () => {
  return `country=US
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid="OROBOT-Setup-${singleton.DeviceData.deviceUuid.slice(0, 5)}"
    mode=2
    proto=wpa
    key_mgmt=WPA-PSK
    psk="wifisetup"
    frequency=2412
}
`;
}

const createNGINXConf = () => {
  return `server {
        listen 80 default_server;
        listen [::]:80 default_server;

        root /var/www/html;

        index index.html index.htm index.nginx-debian.html;

        server_name _;

        location / {
                proxy_pass http://localhost:3006;
                proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection 'upgrade';
                proxy_set_header Host $host;
                proxy_cache_bypass $http_upgrade;
        }
}`;
}

const createDHCPConf = () => {
  return `interface wlan0
    static ip_address=192.168.4.1
    nohook wpa_supplicant
    denyinterfaces veth*`
}

const createDNSConf = () => {
  return `interface=wlan0 # Listening interface
dhcp-range=192.168.4.2,192.168.4.20,255.255.255.0,24h
                # Pool of IP addresses served via DHCP
domain=wlan     # Local wireless DNS domain
address=/gw.wlan/192.168.4.1
                # Alias for this router`;
}

const hostAPDConf = () => {
  return `
interface=wlan0
#If this fails, try rt1871xdrv a
driver=nl80211
# Name of the new network: best use the hostname
ssid=OROBOT-Setup-${singleton.DeviceData.deviceUuid.slice(0, 5)}
# Pick a channel not already in use
channel=6
# Change to b for older devices?
hw_mode=g
macaddr_acl=0
auth_algs=3
# Disable this to insure the AP is visible:
ignore_broadcast_ssid=0
wpa=2
country_code=US
wpa_passphrase=wifisetup
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP
`;
}

const defaultHostAPDConf = () => {
  return `
  DAEMON_CONF="/etc/hostapd/hostapd.conf"
  DAEMON_OPTS="-dd -t -f /home/pi/hostapd.log"
`;
};

const defaultHostAPDConfPath = '/etc/default/hostapd';

const createHosts = () => {
  return `127.0.0.1	localhost
::1		localhost ip6-localhost ip6-loopback
ff02::1		ip6-allnodes
ff02::2		ip6-allrouters

127.0.1.1		orobotwifi.io
127.0.1.1		raspberrypi`;
}

const upWifiAP = () => {
  //fs.writeFileSync(wpaConfPath, createWPAConf());
  fs.writeFileSync(dnsConfPath, createDNSConf());
  fs.writeFileSync(hostsPath, createHosts());
  fs.writeFileSync(hostAPDPath, hostAPDConf());
  fs.writeFileSync(dhcpPath, createDHCPConf());
  fs.writeFileSync(nginxPath, createNGINXConf());
  fs.writeFileSync(defaultHostAPDConfPath, defaultHostAPDConf());
}

module.exports = {
  upWifiAP
}
