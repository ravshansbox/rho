# VPS Setup Guide

Run Rho on a remote server for always-on access from any device.

## Option 1: Oracle Cloud Free Tier ($0/month)

Oracle offers an always-free ARM instance -- 4 cores, 24GB RAM. More than enough for Rho.

1. Sign up at https://cloud.oracle.com/
2. Create a Compute instance:
   - Shape: VM.Standard.A1.Flex (Ampere ARM)
   - 1 OCPU, 6GB RAM is plenty (stay within free tier)
   - OS: Ubuntu 22.04 or 24.04
   - Add your SSH public key
3. Note the public IP address
4. Open port 22 in the Security List (default VCN should have this)

SSH in and install:

```bash
ssh ubuntu@<your-ip>

# Install dependencies
sudo apt update && sudo apt install -y nodejs npm tmux

# Install Rho
npm install -g @mariozechner/pi-coding-agent @rhobot-dev/rho
rho init && rho sync
rho login
rho start   # start in background
```

The free tier never expires. Your Rho instance runs indefinitely.

## Option 2: Hetzner Cloud ($4.50/month)

Reliable, fast, good value.

1. Sign up at https://console.hetzner.cloud/
2. Create a server:
   - Location: nearest to you
   - Type: CX22 (2 vCPU, 4GB RAM) -- $4.50/month
   - OS: Ubuntu 24.04
   - Add your SSH key
3. SSH in and install Rho (same steps as above)

## Option 3: DigitalOcean ($4/month)

1. Sign up at https://cloud.digitalocean.com/
2. Create a Droplet:
   - Basic plan, $4/month (1 vCPU, 512MB RAM -- sufficient for Rho)
   - Ubuntu 24.04
   - Add your SSH key
3. SSH in and install Rho

## SSH key setup

If you don't have an SSH key:

```bash
ssh-keygen -t ed25519 -C "rho-server"
cat ~/.ssh/id_ed25519.pub
```

Copy the public key and add it when creating your server.

On your iPhone, import the private key into Termius:
- Settings > Keychain > + > Import from clipboard (or file)

## Firewall basics

Most VPS providers have a firewall/security group. You need:
- Port 22 (SSH) open to your IP or anywhere
- All other ports closed

On the server itself, optionally:

```bash
sudo ufw allow ssh
sudo ufw enable
```

## Keeping Rho running

Rho runs in tmux, so it survives SSH disconnects. But if the server reboots, you need to restart it. Add to crontab:

```bash
crontab -e
```

Add this line:

```
@reboot sleep 10 && $HOME/.local/bin/rho start
```

This starts Rho in the background 10 seconds after boot.
