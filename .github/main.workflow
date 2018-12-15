workflow "New workflow" {
  on = "push"
  resolves = ["plg"]
}

action "plg" {
  uses = "actions/npm@6309cd9"
  args = "run pkg"
}
