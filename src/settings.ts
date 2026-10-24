import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type { DragOptions } from './drag';
import type BlockDragLinksPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface BlockDragLinksSettings {
	/** Pro: drag every block of a selection, one link for each block. */
	multiBlock: boolean;
	/** Pro: make a new id from the first words of the block, for example ^call-bob. */
	readableIds: boolean;
}

export const DEFAULT_SETTINGS: BlockDragLinksSettings = {
	multiBlock: true,
	readableIds: false,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<BlockDragLinksSettings> | null | undefined): BlockDragLinksSettings {
	const s = saved ?? {};
	return {
		multiBlock: typeof s.multiBlock === 'boolean' ? s.multiBlock : DEFAULT_SETTINGS.multiBlock,
		readableIds: typeof s.readableIds === 'boolean' ? s.readableIds : DEFAULT_SETTINGS.readableIds,
	};
}

/** The options in effect. Without Pro: one block for each drag and random ids. */
export function effectiveOptions(settings: BlockDragLinksSettings, pro: boolean): DragOptions {
	return { multi: pro && settings.multiBlock, readable: pro && settings.readableIds };
}

export class BlockDragLinksSettingTab extends PluginSettingTab {
	plugin: BlockDragLinksPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: BlockDragLinksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Drag all blocks of a selection',
				desc: 'Pro. Select lines across several blocks, then drag the handle of one of them. The drop inserts one link for each block, one for each line.',
				control: { type: 'toggle', key: 'multiBlock', defaultValue: DEFAULT_SETTINGS.multiBlock, disabled: () => !isPro() },
			},
			{
				name: 'Readable block IDs',
				desc: 'Pro. Make a new block ID from the first three words of the block, for example ^call-bob. When this is off, a new ID has 6 random letters and digits, as Obsidian makes.',
				control: { type: 'toggle', key: 'readableIds', defaultValue: DEFAULT_SETTINGS.readableIds, disabled: () => !isPro() },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: the two settings above work.'
					: 'Free version: drag one heading or one block to insert a link, hold Ctrl or Cmd at the drop for an embed, and get a block ID in the source note. Pro adds the drag of all blocks of a selection and readable block IDs.',
			},
			// The Pro group comes after the settings of the plugin.
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
	}
}
