workflow "New workflow" {
  on = "push"
  resolves = ["pkg"]
}

action "install" {
  uses = "actions/npm@6309cd9"
  args = "install"
}

action "pkg" {
  uses = "actions/npm@6309cd9"
  args = "run pkg"
  needs = ["install"]
}
