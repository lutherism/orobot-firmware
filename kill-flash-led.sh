ps -aux | grep -v grep | grep flash-led.js | awk '{print $2}' | xargs kill || true

echo 1 | sudo tee /sys/class/leds/led0/brightness
