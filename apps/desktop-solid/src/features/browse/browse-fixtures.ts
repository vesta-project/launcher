import type {
  ResourceCategory,
  ResourceProject,
  ResourceType,
  ResourceVersion,
  ResourceVersionDetails,
  SourceId,
} from './browse-model';

/** Small deterministic dataset for the plain-browser preview; the host serves real data in Tauri. */

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();

function project(
  id: string,
  name: string,
  type: ResourceType,
  summary: string,
  author: string,
  downloads: number,
  categories: string[],
  updatedDaysAgo: number,
  source: SourceId = 'modrinth',
): ResourceProject {
  return {
    id,
    source,
    resource_type: type,
    name,
    summary,
    description: null,
    icon_url: null,
    author,
    authors: [author],
    author_details: [{ id: `user-${author.toLowerCase()}`, username: author, avatar_url: null, is_owner: true }],
    organization: null,
    download_count: downloads,
    follower_count: Math.round(downloads / 40),
    categories,
    web_url: `https://${source}.example/${id}`,
    gallery: [],
    featured_gallery: null,
    published_at: ago(updatedDaysAgo + 200),
    updated_at: ago(updatedDaysAgo),
  };
}

const modrinth: ResourceProject[] = [
  project(
    'sodium',
    'Sodium',
    'mod',
    'A modern rendering engine and client-side optimization mod for Minecraft.',
    'jellysquid3',
    91_000_000,
    ['optimization', 'fabric', 'quilt'],
    3,
  ),
  project(
    'lithium',
    'Lithium',
    'mod',
    'A server-side optimization mod that improves game logic, physics and AI.',
    'jellysquid3',
    64_000_000,
    ['optimization', 'fabric', 'quilt'],
    8,
  ),
  project(
    'iris',
    'Iris Shaders',
    'mod',
    'A modern shaders mod compatible with existing OptiFine shader packs.',
    'coderbot',
    58_000_000,
    ['decoration', 'fabric', 'quilt'],
    5,
  ),
  project(
    'create',
    'Create',
    'mod',
    'Aesthetic technology that empowers the player through contraptions and automation.',
    'simibubi',
    45_000_000,
    ['technology', 'adventure', 'forge', 'neoforge', 'fabric'],
    12,
  ),
  project(
    'jei',
    'Just Enough Items',
    'mod',
    'View items and recipes in-game with a fast, searchable overlay.',
    'mezz',
    120_000_000,
    ['utility', 'forge', 'neoforge'],
    2,
  ),
  project(
    'modmenu',
    'Mod Menu',
    'mod',
    'Adds a mod menu to view the list of mods you have installed.',
    'prospector',
    70_000_000,
    ['utility', 'fabric', 'quilt'],
    20,
  ),
  project(
    'ae2',
    'Applied Energistics 2',
    'mod',
    'A mod about matter, energy and using them to automate storage.',
    'ae-team',
    30_000_000,
    ['storage', 'technology', 'forge', 'neoforge', 'fabric'],
    6,
  ),
  project(
    'fo',
    'Fabulously Optimized',
    'modpack',
    'Performance and visuals with quality-of-life improvements.',
    'robotkoer',
    9_000_000,
    ['optimization', 'fabric'],
    4,
  ),
  project(
    'atm10',
    'All the Mods 10',
    'modpack',
    'Kitchen sink modpack with more than 400 mods.',
    'atmteam',
    3_200_000,
    ['kitchen-sink', 'neoforge'],
    9,
  ),
  project(
    'faithful',
    'Faithful 32x',
    'resourcepack',
    'A higher resolution take on the default textures.',
    'faithful',
    17_000_000,
    ['vanilla-like', 'decoration'],
    30,
  ),
  project(
    'complementary',
    'Complementary Reimagined',
    'shader',
    'A shader pack focused on a vanilla-plus look with strong performance.',
    'emin',
    22_000_000,
    ['vanilla-like', 'performance'],
    7,
  ),
  project(
    'terralith',
    'Terralith',
    'datapack',
    'Overhauls overworld generation with 100+ new biomes.',
    'stardustlabs',
    12_000_000,
    ['worldgen'],
    15,
  ),
  project(
    'hardcore',
    'Hardcore Island',
    'world',
    'A small survival island map with a handful of secrets.',
    'mapmaker',
    400_000,
    ['adventure', 'survival'],
    120,
  ),
];

const curseforge: ResourceProject[] = [
  project(
    '306612',
    'Fabric API',
    'mod',
    'Essential hooks for modding with Fabric.',
    'modmuss50',
    150_000_000,
    ['api-and-library', 'fabric'],
    1,
    'curseforge',
  ),
  project(
    '238222',
    'Just Enough Items (JEI)',
    'mod',
    'View items and recipes.',
    'mezz',
    300_000_000,
    ['utility', 'forge'],
    2,
    'curseforge',
  ),
  project(
    '1000',
    'RLCraft',
    'modpack',
    'A hardcore survival experience.',
    'shivaxi',
    90_000_000,
    ['hardcore'],
    40,
    'curseforge',
  ),
];

// One project carries a full page so the preview exercises the description, links and gallery.
Object.assign(modrinth[0], {
  description: [
    '# Sodium',
    '',
    'Sodium is a **free and open-source** rendering engine replacement for the Minecraft client.',
    '',
    '- Much higher frame rates',
    '- Fewer stutters and smoother chunk loading',
    '- Works with [Iris Shaders](https://modrinth.com/mod/iris)',
    '',
    '> Sodium is not a drop-in replacement for OptiFine.',
    '',
    '| Feature | Status |',
    '| --- | --- |',
    '| Chunk rendering | Rewritten |',
    '| Entity culling | Built in |',
    '',
    '```',
    'sodium-options.json',
    '```',
  ].join('\n'),
  links: [
    { kind: 'source', label: 'Source code', url: 'https://github.com/CaffeineMC/sodium', donation: false },
    { kind: 'issues', label: 'Issues', url: 'https://github.com/CaffeineMC/sodium/issues', donation: false },
    { kind: 'discord', label: 'Discord', url: 'https://discord.example/sodium', donation: false },
    { kind: 'kofi', label: 'Ko-fi', url: 'https://ko-fi.example/sodium', donation: true },
  ],
  environment: { client: true, server: false },
});

export const fixtureProjects: ResourceProject[] = [...modrinth, ...curseforge];

const icon = (path: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const category = (id: string, name: string, svg: string, type: ResourceType = 'mod'): ResourceCategory => ({
  id,
  name,
  icon_url: icon(svg),
  project_type: type,
  parent_id: null,
  display_index: null,
});

export const fixtureCategories: ResourceCategory[] = [
  ...(['mod', 'modpack'] as ResourceType[]).flatMap((type) => [
    category('optimization', 'Optimization', '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>', type),
    category(
      'technology',
      'Technology',
      '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
      type,
    ),
    category('utility', 'Utility', '<path d="M14 7 7 14l3 3 7-7zM4 20l3-3"/>', type),
    category('adventure', 'Adventure', '<path d="m3 21 9-18 9 18z"/>', type),
    category('storage', 'Storage', '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3"/>', type),
    category(
      'decoration',
      'Decoration',
      '<path d="M12 3l2.5 6 6.5.5-5 4.5 1.5 6.5L12 17l-5.5 3.5L8 14 3 9.5 9.5 9z"/>',
      type,
    ),
    category('kitchen-sink', 'Kitchen sink', '<path d="M4 11h16v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/>', type),
    category('fabric', 'Fabric', '<path d="M4 4h16v16H4z"/>', type),
    category('forge', 'Forge', '<path d="M4 4h16v16H4z"/>', type),
  ]),
  category('vanilla-like', 'Vanilla-like', '<rect x="4" y="4" width="16" height="16" rx="2"/>', 'resourcepack'),
  category(
    'decoration',
    'Decoration',
    '<path d="M12 3l2.5 6 6.5.5-5 4.5 1.5 6.5L12 17l-5.5 3.5L8 14 3 9.5 9.5 9z"/>',
    'resourcepack',
  ),
  category('vanilla-like', 'Vanilla-like', '<rect x="4" y="4" width="16" height="16" rx="2"/>', 'shader'),
  category('performance', 'Performance', '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>', 'shader'),
  category('worldgen', 'World generation', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>', 'datapack'),
  category('adventure', 'Adventure', '<path d="m3 21 9-18 9 18z"/>', 'world'),
  category('survival', 'Survival', '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>', 'world'),
];

export const fixtureCurseforgeCategories: ResourceCategory[] = [
  { id: 'cf-tech', name: 'Technology', icon_url: null, project_type: 'mod', parent_id: null, display_index: 1 },
  { id: 'cf-farming', name: 'Farming', icon_url: null, project_type: 'mod', parent_id: 'cf-tech', display_index: 1 },
  { id: 'cf-energy', name: 'Energy', icon_url: null, project_type: 'mod', parent_id: 'cf-tech', display_index: 2 },
  { id: 'cf-api', name: 'API and Library', icon_url: null, project_type: 'mod', parent_id: null, display_index: 2 },
  { id: 'utility', name: 'Utility', icon_url: null, project_type: 'mod', parent_id: null, display_index: 3 },
];

export function fixtureSearch(
  source: SourceId,
  query: {
    text: string | null;
    resource_type: ResourceType;
    categories: string[] | null;
    offset: number;
    limit: number;
    loader: string | null;
  },
) {
  const text = query.text?.toLowerCase();
  const hits = fixtureProjects.filter(
    (item) =>
      item.source === source &&
      item.resource_type === query.resource_type &&
      (!text || item.name.toLowerCase().includes(text) || item.summary.toLowerCase().includes(text)) &&
      (!query.categories?.length || query.categories.every((id) => item.categories.includes(id))) &&
      (!query.loader || item.categories.includes(query.loader)),
  );
  return { hits: hits.slice(query.offset, query.offset + query.limit), total_hits: hits.length };
}

export function fixtureVersions(projectId: string): ResourceVersion[] {
  const make = (
    id: string,
    number: string,
    games: string[],
    loaders: string[],
    type: ResourceVersion['release_type'],
    age: number,
  ): ResourceVersion => ({
    id: `${projectId}-${id}`,
    project_id: projectId,
    version_number: number,
    game_versions: games,
    loaders,
    download_url: `https://example.invalid/${projectId}-${number}.jar`,
    file_name: `${projectId}-${number}.jar`,
    release_type: type,
    hash: '',
    dependencies:
      id === '3'
        ? [
            { project_id: 'modmenu', version_id: null, file_name: null, dependency_type: 'optional' },
            { project_id: 'lithium', version_id: null, file_name: null, dependency_type: 'required' },
            { project_id: 'optifine', version_id: null, file_name: 'OptiFine', dependency_type: 'incompatible' },
          ]
        : [],
    published_at: ago(age),
    download_count: Math.round(400_000 / (Number(id) + 1)),
    file_size: 1_200_000 + Number(id) * 40_000,
    files: [],
  });
  return [
    make('4', '2.0.0-beta.1', ['1.21.4'], ['fabric', 'neoforge'], 'beta', 2),
    make('3', '1.9.0', ['1.21.4', '1.21.1'], ['fabric', 'quilt', 'neoforge', 'forge'], 'release', 20),
    make('2', '1.5.2', ['1.20.1'], ['fabric', 'forge'], 'release', 120),
    make('1', '1.0.0', ['1.12.2', '1.8.9'], ['forge'], 'release', 600),
  ];
}

export function fixtureVersionDetails(projectId: string, versionId: string): ResourceVersionDetails | undefined {
  const version = fixtureVersions(projectId).find((item) => item.id === versionId);
  if (!version) return undefined;
  const changelog = version.release_type === 'release'
    ? `## ${version.version_number}\n\n- Faster chunk meshing\n- Fixed a crash when resizing the window\n- Updated translations`
    : null;
  return {
    version,
    changelog,
    changelog_format: 'markdown',
    changelog_status: changelog ? 'available' : 'empty',
  };
}
