$IP = 192.168.220.1

ifconfig wlan0 $IP; systemctl start hostapd; systemctl start dnsmasq
