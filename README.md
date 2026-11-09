# Dungeon Crawler Carl Foundry VTT system

An official Foundry VTT **v14** game system. System id: `dungeon-crawler-carl`

Actor types: **Crawler** (`pc`), **Mob** (`mob`), and **Vehicle / Mount** (`vehicle`). Item types: weapon, skill, spell, gear.

On Mob sheets, the Combat pencil reveals editable bases while keeping totals visible. Surprise and Evade add Floor, and Move combines effective Move and Step. Mobs with a Spell show a manually editable mana pool; enter current and maximum mana before casting.

On Crawler sheets, the Abilities pencil reveals the Unenhanced score inputs. The Combat Edit control reveals Armor, Move Base, Step Base, AI Favor, and Size inputs. Move and Step totals remain visible while editing; Evade can still be rolled from its total.

Mob To-Hit is set per Attack: open the Attack to edit its base or mark it as having no To-Hit. The displayed target applies attack modifiers and adds Floor; new Mob Attacks seed their base from Ability and Rank.

## Install

In Foundry's **Game Systems** tab, choose **Install System** and enter this manifest URL:

`https://raw.githubusercontent.com/nextabletop/foundry-dungeon-crawler-carl/main/system.json`

Releases publish an installable ZIP automatically when a version tag matching `system.json` is pushed (for example, `v0.1.0`). The first release must be published before Foundry can download the system.
