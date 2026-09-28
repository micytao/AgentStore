# AgentStore Execution Environment

An [ansible-builder](https://ansible.readthedocs.io/projects/builder/) v3
definition (`execution-environment.yml`) plus a hand-written equivalent
`Containerfile` for the AAP Execution Environment both
[../provision-generic-agent.yml](../provision-generic-agent.yml) and
[../provision-openshell-gateway.yml](../provision-openshell-gateway.yml)
need: the `kubernetes.core` collection (used by both) plus the `helm` CLI
(used only by the gateway playbook).

AAP's controller API has no endpoint to *build* a container image, only
to register one that already exists in a registry — that's a real
product limitation, not something AgentStore can route around, and it's
also why AAP's own web UI doesn't have a "build" button either.
*Registering* an already-built image (the last step below) **can** be
automated, though — from AgentStore itself, or from AAP's UI. Building
the image has to happen somewhere that isn't AAP; pick one of the two
options below for *where*.

## Option B (recommended): build inside OpenShift, triggered from AgentStore

If AgentStore already has your OpenShift cluster connected (Admin ->
Platform -> OpenShift), it can build this image for you with one click —
no local `ansible-builder`/`podman` install needed:

1. Fill in **Project Git URL** / **Branch** on the "AAP Job Templates"
   card (Admin -> Platform) — the same repo/branch used for the AAP
   Project also has to contain this directory's `Containerfile`.
2. Click **"+ Build from source"**, give it a name (defaults to
   "AgentStore execution environment"), and click **Start build**.
3. AgentStore creates an OpenShift `ImageStream` + `BuildConfig` (Docker
   strategy, source: that Git repo, context dir
   `ansible/execution-environment`), triggers a Build, and polls it.
   Once it's `Complete`, it reads back the built image's pullable
   reference from the internal registry and registers it as an AAP
   Execution Environment automatically — same as Option A's step 3, just
   with no manual image reference to copy/paste.

Caveats:

- The build runs **inside the OpenShift cluster's internal registry**
  (`image-registry.openshift-image-registry.svc:5000/<namespace>/...`).
  AAP's execution nodes need to be able to pull from it — straightforward
  if AAP itself runs on/near that cluster (e.g. installed via the AAP
  Operator on OpenShift), more work otherwise (you'd need a **Container
  Registry** credential in AAP that can authenticate to it, picked via
  the same-named dropdown in the "+ Build from source" mini-form).
- If your repo is private, the OpenShift `BuildConfig` needs its own
  `kubernetes.io/basic-auth`/`kubernetes.io/ssh-auth` Secret (separate
  from the AAP-side SCM credential the Project uses) — not yet wired into
  the UI; ask an admin with cluster access to create one and reach out if
  you need this automated too.
- If the build fails, its logs are in the OpenShift console (Builds ->
  `agentstore-ee-N`) — AgentStore surfaces the terminal phase
  (`Failed`/`Error`/`Cancelled`) but not the full log.

## Option A: build locally (or in CI), then register

### 1. Build

```bash
cd ansible/execution-environment
pip install ansible-builder
ansible-builder build \
  -t <your-registry>/agentstore-ee:latest \
  -f execution-environment.yml \
  --container-runtime podman
```

### 2. Push

```bash
podman push <your-registry>/agentstore-ee:latest
```

Use any registry AAP's execution nodes can pull from (Quay, an internal
registry, etc.). If it's private, create a **Container Registry**
credential in AAP first (or via AgentStore's "Register a new image"
action below, if a registry credential dropdown is shown).

### 3. Register it in AAP

Either:

- **From AgentStore**: Admin -> Platform -> AAP Job Templates -> Execution
  environment -> "Register a new image" -> paste
  `<your-registry>/agentstore-ee:latest`, pick a registry credential if
  private, click **Register**. It shows up in the dropdown immediately
  and gets auto-selected.
- **From AAP directly**: Automation Execution -> Infrastructure ->
  Execution Environments -> Add -> same image reference.

## Verifying the image locally (optional, Option A only)

```bash
podman run --rm <your-registry>/agentstore-ee:latest ansible-doc -l kubernetes.core
podman run --rm <your-registry>/agentstore-ee:latest helm version
```

Both commands should print output, not "command not found"/"plugin not
found", before you point a Job Template at this EE.
