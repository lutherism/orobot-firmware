BASEDIR="/home/pi/orobot-firmware"

sudo git pull
sudo $BASEDIR/kill-keep-alive.sh
sudo $BASEDIR/reboot.sh
