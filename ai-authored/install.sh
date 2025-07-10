#!/bin/bash

set -e

# Update and upgrade system packages
sudo apt update
sudo apt upgrade -y

# Install required packages
sudo apt install -y git hostapd dnsmasq avahi-daemon libnss-mdns libmicrohttpd-dev

# Install nodogsplash from source
git clone https://github.com/nodogsplash/nodogsplash.git /tmp/nodogsplash
cd /tmp/nodogsplash
make
sudo make install
cd -

# Install Node.js using nodesource
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# Clone the GitHub repository (replace with actual repo URL)
sudo mkdir -p /opt/orobot/public
git clone https://github.com/yourusername/orobot.git /tmp/orobot  # Replace 'yourusername/orobot' with actual repo
sudo cp /tmp/orobot/*.js /opt/orobot/
sudo cp /tmp/orobot/*.json /opt/orobot/  # For networks.json if present
sudo cp -r /tmp/orobot/public/* /opt/orobot/public/
sudo touch /opt/orobot/networks.json  # Ensure exists if not in repo

# Install Node.js dependencies (assuming package.json in repo)
cd /opt/orobot
sudo npm install

# Create /etc/hostapd/hostapd.conf
cat <<EOF | sudo tee /etc/hostapd/hostapd.conf
interface=wlan0
driver=nl80211
ssid=Orobot-Setup
hw_mode=g
channel=6
wpa=0
EOF

# Backup and create /etc/dnsmasq.conf
sudo mv /etc/dnsmasq.conf /etc/dnsmasq.conf.orig || true
cat <<EOF | sudo tee /etc/dnsmasq.conf
interface=wlan0
dhcp-range=192.168.50.50,192.168.50.150,12h
EOF

# Create /etc/nodogsplash/nodogsplash.conf
sudo mkdir -p /etc/nodogsplash
cat <<EOF | sudo tee /etc/nodogsplash/nodogsplash.conf
GatewayInterface wlan0
GatewayAddress 192.168.50.1
RedirectURL http://192.168.50.1:3000/
FirewallRuleSet preauthenticated-users {
    FirewallRule allow tcp port 80
    FirewallRule allow tcp port 443
}
EOF

# Create /etc/avahi/services/orobot.service
sudo mkdir -p /etc/avahi/services
cat <<EOF | sudo tee /etc/avahi/services/orobot.service
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">%h</name>
  <service>
    <type>_orobot._tcp</type>
    <port>3000</port>
  </service>
</service-group>
EOF

# Create /etc/systemd/system/orobot.service
cat <<EOF | sudo tee /etc/systemd/system/orobot.service
[Unit]
Description=Orobot WiFi Manager
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/orobot/app.js
Restart=always
User=root

[Install]
WantedBy=multi-user.target
EOF

# Create initial /etc/wpa_supplicant/wpa_supplicant.conf
cat <<EOF | sudo tee /etc/wpa_supplicant/wpa_supplicant.conf
country=US
update_config=1
EOF

# Stop and disable services initially (managed by app)
sudo systemctl stop hostapd dnsmasq nodogsplash wpa_supplicant || true
sudo systemctl disable hostapd dnsmasq nodogsplash wpa_supplicant || true

# Reload systemd, enable and start orobot service
sudo systemctl daemon-reload
sudo systemctl enable orobot
sudo systemctl start orobot

# Cleanup temp files
rm -rf /tmp/nodogsplash /tmp/orobot

echo "Installation complete. Reboot the device for changes to take effect."
