# MySQL Helm Chart

## Overview
Deploys a MySQL StatefulSet.

## Components
- StatefulSet (1 replica by default)
- Headless Service for stable network ID
- ClusterIP Service for access
- ConfigMap for `my.cnf`
- Secret for credentials

## Persistence
Uses PVC with `standard` storage class by default.
