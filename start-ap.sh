#!/bin/bash
interfaceWifi=wlan0
interfaceWired=eth0
ipAddress=192.168.4.1/24
deviceUuid=$(<scripts/openroboticsdata/.deviceUuid)
deviceSlug=$(echo deviceUuid | cut -c1-5)
### Check if run as root ############################
if [[ $EUID -ne 0 ]]; then
	echo "This script must be run as root"
	echo "Try \"sudo $0\""
	exit 1
fi

## Change over to systemd-networkd
## https://raspberrypi.stackexchange.com/questions/108592
# deinstall classic networking
apt --autoremove -y purge ifupdown dhcpcd5 isc-dhcp-client isc-dhcp-common rsyslog
apt-mark hold ifupdown dhcpcd5 isc-dhcp-client isc-dhcp-common rsyslog raspberrypi-net-mods openresolv
rm -r /etc/network /etc/dhcp

# setup/enable systemd-resolved and systemd-networkd
apt --autoremove -y purge avahi-daemon
apt-mark hold avahi-daemon libnss-mdns
apt install -y libnss-resolve
ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf
systemctl enable systemd-networkd.service systemd-resolved.service

cat > /etc/wpa_supplicant/wpa_supplicant-wlan0.conf <<-EOF
	country=US
	ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
	update_config=1
	ap_scan=1

	### your access point/hotspot ###
	network={
	    ssid="oRobot-Setup-$deviceSlug"    # your hotspot's name
	    mode=2
	    key_mgmt=WPA-PSK
	    psk="orobotio"        # your hotspot's password
	    frequency=2462
	}
EOF

## Install configuration files for systemd-networkd
cat > /etc/systemd/network/04-${interfaceWired}.network <<-EOF
	[Match]
	Name=$interfaceWired
	[Network]
	DHCP=yes
EOF

cat > /etc/systemd/network/08-${interfaceWifi}-CLI.network <<-EOF
	[Match]
	Name=$interfaceWifi
	[Network]
	DHCP=yes
	LinkLocalAddressing=yes
	MulticastDNS=yes
EOF

cat > /etc/systemd/network/12-${interfaceWifi}-AP.network <<-EOF
	[Match]
	Name=$interfaceWifi
	[Network]
	Address=$ipAddress
	IPForward=yes
	IPMasquerade=yes
	DHCPServer=yes
	LinkLocalAddressing=yes
	MulticastDNS=yes
	[DHCPServer]
	DNS=84.200.69.80 84.200.70.40 1.1.1.1
EOF

cp $(pwd)/auto-hotspot /usr/local/sbin/
chmod +x /usr/local/sbin/auto-hotspot

## Install systemd-service to configure interface automatically
if [ ! -f /etc/systemd/system/wpa_cli@${interfaceWifi}.service ] ; then
	cat > /etc/systemd/system/wpa_cli@${interfaceWifi}.service <<-EOF
		[Unit]
		Description=Wpa_cli to Automatically Create an Accesspoint if no Client Connection is Available
		After=wpa_supplicant@%i.service
		BindsTo=wpa_supplicant@%i.service
		[Service]
		ExecStart=/sbin/wpa_cli -i %I -a /usr/local/sbin/auto-hotspot
		Restart=on-failure
		RestartSec=1
		[Install]
		WantedBy=multi-user.target
	EOF
else
  echo "wpa_cli@$interfaceWifi.service is already installed"
fi

systemctl daemon-reload
systemctl enable wpa_cli@${interfaceWifi}.service
echo "Reboot now!"
reboot
exit 0
