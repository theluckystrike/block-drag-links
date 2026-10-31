# Block Drag Links

Block Drag Links lets you drag a heading or a block from one note into another note and get a link to it. Drop a paragraph, and the other note gets `[[Research#^k3x9qa]]`. The source paragraph gets the block ID `^k3x9qa` at its end if it had none. Hold Ctrl (Cmd on macOS) at the drop to insert an embed, `![[Research#^k3x9qa]]`, instead of a link.

Obsidian makes a heading link when you drop an item from the Outline view. It makes a block ID only when you pick a block in the `[[Note#^` link suggestions. It cannot drag a paragraph, a list item or a callout from the editor. This plugin adds that drag gesture. It answers the forum request "Create references for headers or blocks by drag-and-drop". The Drag Bi-Link plugin also makes block links, with an Alt drag that turns selected text into a link.

## Features

### Drag a block to link it

Drag the handle of a block into another note. The drop inserts a block link there, and the source block gets a new block ID. The animation shows the hover, the drop of a paragraph and the drop of a heading.

<img src="https://raw.githubusercontent.com/theluckystrike/block-drag-links/HEAD/docs/block-drag-links.gif" alt="A pointer over a paragraph shows a handle, the paragraph is dropped into another note as a block link, then a heading is dropped as a heading link" width="720">

<img src="https://raw.githubusercontent.com/theluckystrike/block-drag-links/HEAD/docs/block-link.png" alt="Two notes side by side: the draft has a block link, and the source paragraph ends with the new block ID" width="720">

A block is a paragraph, a list item, a task, a blockquote, a callout or a table. A paragraph, a list item and a task get ` ^id` at the end of their last line. A blockquote, a callout and a table get the ID on its own line after the block, with a blank line before it and after it, as Obsidian needs. A block that has an ID keeps it, and the link uses it. A new ID has 6 letters and digits, as Obsidian makes them, and it is not used in the note yet.

Free: one heading or one block for each drag, links and embeds, new block IDs. Pro: all blocks of a selection in one drag, and readable block IDs. $15 one time or $5 a month: [Sponsor](https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=block-drag-links).

### The drag handle

The handle shows at the first line of the block under the pointer. It does not show on code blocks (fenced or indented), math blocks, comments, HTML blocks, footnote definitions, horizontal rules, the note properties or empty lines. The plugin cannot add a block ID to these safely.

<img src="https://raw.githubusercontent.com/theluckystrike/block-drag-links/HEAD/docs/drag-handle.png" alt="A handle with six dots at the left of a paragraph" width="720">

### Drag a heading

Drop a heading to get a heading link, such as `[[Research#Method sources 1]]`. The plugin uses the same rule as core links: a colon, a hash, a pipe, a caret, a backslash and the pairs `%%`, `[[` and `]]` become a space. A heading needs no block ID, so the source note does not change.

<img src="https://raw.githubusercontent.com/theluckystrike/block-drag-links/HEAD/docs/heading-link.png" alt="The heading Method: sources #1 dropped into the draft as the link Research#Method sources 1" width="720">

### Embed with Ctrl or Cmd

Hold Ctrl (Cmd on macOS) when you release the block. The drop inserts an embed, and Live Preview shows the block text in the other note.

<img src="https://raw.githubusercontent.com/theluckystrike/block-drag-links/HEAD/docs/embed.png" alt="The draft shows an embed of the paragraph from the research note" width="720">

## Install

1. Open "Settings → Community plugins" and turn off restricted mode.
2. Select "Browse", search for "Block Drag Links", then select "Install" and "Enable".

To install by hand, copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/block-drag-links/`. Then enable the plugin. You need Obsidian 1.13.4 or later on a desktop computer.

## Usage

1. Open the source note and the target note side by side.
2. Move the pointer over a heading or a block in the source note. A handle shows at its left.
3. Drag the handle to the place in the target note where the link goes, and release it. Hold Ctrl or Cmd before you release it to insert an embed.

The plugin makes the link with the link API of Obsidian, so your settings in "Settings → Files and links" apply.

You can also drop in the same note. The link then has no note name: `[[#Method sources 1]]` or `[[#^k3x9qa]]`. In the same note, the new ID and the link are one change, so one Undo removes both.

When the source note is open in an editor, the plugin adds the ID through that editor. Undo in the source note removes the ID. When the source note is not open, the plugin writes the ID to the file with the Obsidian file API. It adds only the ID. Every other byte of the note stays the same. Before it writes, it compares the block with the text at the start of the drag. If the block changed, it writes nothing, inserts no link and shows a notice.

A drag that you cancel writes nothing.

With Pro, select lines across several blocks, then drag the handle of one block in the selection. The drop inserts one link (or embed) for each block, each on its own line, and each block gets its ID.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

| Setting | What it does |
| --- | --- |
| Drag all blocks of a selection | Pro. One drag links every block of the selection. On by default when Pro is on. |
| Readable block IDs | Pro. A new ID comes from the first three words of the block, for example `^call-bob-about`. If that ID is used, the plugin adds `-2`, `-3` and so on. Off by default. |

<img src="https://raw.githubusercontent.com/theluckystrike/block-drag-links/HEAD/docs/settings.png" alt="The settings tab with the two Pro settings first and the Pro section below them" width="720">

## Pro

To sign in and enable Pro:

1. Sponsor via [GitHub Sponsors](https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=block-drag-links). A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply.
2. In Obsidian, open the settings of Block Drag Links and select "Sign in with GitHub".
3. The plugin copies a code and opens github.com/login/device. Paste the code there and approve.

If you sponsor after you sign in, select Refresh. A negative sponsorship answer turns Pro off.

## FAQ

### Does it work on a phone or a tablet?

No. The plugin is for desktop only. On a touch screen, a long press in the editor opens the menu and selects text. It does not start a drag from the handle.

### Can I drag from Reading view, search results or a canvas?

No. The handle is in the editor, in Live Preview and Source mode. A canvas is not a note editor.

### Why is there no handle on my code block?

The plugin does not write into a code block, a math block or the note properties. Put the block in a callout, or link to the heading above it.

### What happens to a block that already has an ID?

The plugin uses the ID that is there: at the end of the block, on the line after a quote, callout or table, or an ID that Obsidian has in its index. It does not add a second ID and does not change the source note.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=block-drag-links. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Block Drag Links makes no network requests. Sign in uses the GitHub device flow. Block Drag Links sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Block Drag Links sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Plugin page: [block-drag-links](https://notemods.com/plugins/block-drag-links/).

Report bugs and ask for features in the GitHub issues of this repository. Add your Obsidian version and a small sample note.

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
