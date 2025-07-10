/*
Load known networks.
Try connecting (use WpaCtrl events for 'CONNECTED'/'DISCONNECTED').
Set up interval (e.g., every 5min) to check internet (ping google.com), retry/fallback if down.
On disconnect: Retry 3x with backoff, then cycle networks, then AP.
Use mdns Node.js lib to browse for _orobot._tcp.local.
On discovery: Fetch /api/networks from peer's IP, merge new networks (avoid duplicates by SSID), save, and attempt connect if better.
Trigger sharing periodically or on connect (e.g., broadcast to discovered peers).
*/
