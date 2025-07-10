/*
Load known networks.
Try connecting (use WpaCtrl events for 'CONNECTED'/'DISCONNECTED').
Set up interval (e.g., every 5min) to check internet (ping google.com), retry/fallback if down.
On disconnect: Retry 3x with backoff, then cycle networks, then AP.
*/
