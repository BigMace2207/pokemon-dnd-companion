# Using this with Claude on any device

The app itself already works on any device: open https://pokemon-dnd.duckdns.org
in a browser (iPhone, tablet, desktop) and sign in. This page is about working
*on* the app with Claude from anywhere.

## Option 1: Claude Code on the web (edits the code, runs tests)

1. Go to claude.ai/code and connect your GitHub account.
2. Pick the `pokemon-dnd-companion` repo.
3. Ask for changes. It reads `CLAUDE.md` automatically, can run
   `python -m unittest discover -s tests -v`, and pushes branches to GitHub.

It cannot deploy to the live server (the SSH key is only on your PC); after it
pushes, deploy from your PC with Claude Code, or ask it there to deploy.

## Option 2: a claude.ai Project (chat, planning, bug reports)

1. In claude.ai create a new Project named "Pokémon D&D Companion".
2. Add the knowledge files: `CLAUDE.md`, `docs/architecture.md`, `README.md`
   (and `server.py`, `js/app.js`, `css/style.css` if you want it to discuss code).
3. Paste this into the Project's custom instructions:

> You are helping with the Pokémon D&D Companion, a tabletop web app: a
> standard-library Python server plus a vanilla-JS front end, live at
> pokemon-dnd.duckdns.org. Follow CLAUDE.md. Players use 1920x1080 and
> 3440x1440 monitors and iPhones, so keep layouts compact, calm and quick to
> use. Never suggest deleting or overwriting save data, and never trust ids sent
> by the browser for permissions. When I describe a bug or idea, ask for what
> you need (screen size, which page, what you expected), and give me changes
> as complete, testable steps.

A Project is for conversation and planning; for actual code changes, use
Option 1 or Claude Code on your computer.
