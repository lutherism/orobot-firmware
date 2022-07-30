BASEDIR="/home/pi/orobot-firmware"
NODE_BIN="/home/pi/.config/nvm/versions/node/v8.17.0/bin/node"

echo "sudo $NODE_BIN $BASEDIR/scripts/prod-networkmode.js" | bash
echo "sudo $BASEDIR/kill-keep-alive.sh" | bash
echo "sudo $BASEDIR/reboot.sh" | bash
