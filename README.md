# Pebble Tesla

Pebble Tesla is a Pebble application which allows Pebble users to interface with the Tesla Fleet API through the watch!

## Supported Features
- View battery percentage
- Unlock/Lock car
- Precondition (warm or heat car)
- Open Trunk
- Open Frunk
- Open and Unlock Charge Port
- Enable/Disable Sentry Mode

## References
### Pebble
Follows the Pebble Developer Guides https://developer.repebble.com/guides/
Implemented as a regular C Pebble Application

### Tesla Fleet API
- Current status of vehicle
    - Vehicle Data endpoint provides Lock status, battery, etc. 
    - https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints#vehicle-data
- View battery percentage
    - https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints#vehicle-data
- Unlock/Lock car
    - https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands#door-lock
    - https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands#door-unlock
- Precondition (warm or heat car)
    - https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands#auto-conditioning-start
    - https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands#auto-conditioning-stop
- Open Trunk
    - https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands#actuate-trunk
- Open Frunk
    - https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands#actuate-trunk
- Open and Unlock Charge Port
    - https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands#charge-port-door-close
    - https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands#charge-port-door-open
- Enable/Disable Sentry Mode
    - https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands#set-sentry-mode

## Billing and Usage
https://developer.tesla.com/docs/fleet-api/billing-and-limits
> Monthly discount of $10 is provided to support individual developers/small applications
Pebble life note helps you take notes for our life. Voice to text translation then a categorization and a todo checklist

## Setup and Configuration
Currently, I am only supporting my personal vehicle and not exposing this on the Pebble App Store.
- Using Tailscale to create a private mesh VPN
- Raspberry PI connected to Tailscale
- Raspberry PI hosts the Trusted Tesla Proxy Server
- My iPhone is connected to my own Tailscale VPN, and traffic is directed directly through my VPN to my Raspberry PI

