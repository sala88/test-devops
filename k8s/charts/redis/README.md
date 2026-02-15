# Redis Helm Chart

## Overview
Deploys a Redis StatefulSet.

## Components
- StatefulSet (1 replica)
- Service
- Secret for password
- ConfigMap for `redis.conf`

## Persistence
Uses PVC for data durability.
