# Minimal Plumb install

```bash
terraform init
terraform apply
kubectl -n plumb port-forward svc/plumb 31337:31337
open http://127.0.0.1:31337/
```

Nothing here needs a Figma token. To add one — and to turn on continuous design
verification — see the root [`deploy/README.md`](../../../README.md).
