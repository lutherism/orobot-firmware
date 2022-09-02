BASEDIR="/home/pi/orobot-firmware"

cd $BASEDIR
sudo git pull
sudo $BASEDIR/kill-keep-alive.sh
sudo $BASEDIR/reboot.sh
