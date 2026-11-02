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

/*
 * Two Modrinth server listings shaped like the live v3 data (2026-11-02): DonutSMP plays vanilla
 * on a range of versions; Aero SMP plays a modpack that is a version of its own project.
 */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const cdn = 'https://cdn.modrinth.com/data';
export const AERO_SMP_ID = 'OgcNPs6n';
export const DONUT_SMP_ID = 'nuPdyMgK';
const servers: ResourceProject[] = [
  {
    ...project(
      DONUT_SMP_ID,
      'DonutSMP',
      'server',
      'DonutSMP is a Minecraft server where you try to become the best player by grinding for loot and fighting others. Joinable on any modern version.',
      'naygimblett',
      0,
      ['competitive', 'pvp', 'smp', 'survival-mode'],
      240,
    ),
    icon_url: `${cdn}/${DONUT_SMP_ID}/dd517f0c1e8451fa0aae3a3c8a69cd2d118e4c99_96.webp`,
    follower_count: 188,
    web_url: 'https://modrinth.com/server/donutsmp',
    description: [
      'DonutSMP is a Minecraft server where you try to become the best player by grinding to get loot and by fighting others.',
      '',
      'The server is joinable on any modern **1.20+** version. The IP is `donutsmp.net` for both Java and Bedrock edition.',
    ].join('\n'),
    links: [
      { kind: 'store', label: 'Store', url: 'https://store.donutsmp.net/', donation: false },
      { kind: 'discord', label: 'Discord', url: 'https://discord.gg/donutsmp', donation: false },
    ],
    server: {
      address: 'donutsmp.net',
      content: {
        kind: 'vanilla',
        gameVersions: ['1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21'],
        recommendedVersion: '1.21.11',
      },
      ping: { at: minutesAgo(6), online: 21_929, max: 50_000, versionName: 'Velocity 1.7.2-26.3', latencyMs: 22 },
      region: 'us_east',
      languages: ['en'],
      plays2w: 10_521,
    },
  },
  {
    ...project(
      AERO_SMP_ID,
      'Aero SMP',
      'server',
      'A no-nonsense server with just Create and Create Aeronautics.',
      'printer',
      41_851,
      ['smp', 'social', 'technical', 'neoforge'],
      53,
    ),
    icon_url: `${cdn}/${AERO_SMP_ID}/12b5d0ea9e6843746e703223699c3e429f8f6da6_96.webp`,
    follower_count: 125,
    web_url: 'https://modrinth.com/server/aero-server',
    gallery: [
      `${cdn}/${AERO_SMP_ID}/images/d35de2035b3879cbf9060c93bdca043428d76274_350.webp`,
      `${cdn}/${AERO_SMP_ID}/images/54c4fd2a3ea2a3d5f4bf275b8e826a8a11efdddd_350.webp`,
      `${cdn}/${AERO_SMP_ID}/images/23651695404471da910cf64d0d561b9f82cc3daf_350.webp`,
    ],
    featured_gallery: `${cdn}/${AERO_SMP_ID}/images/d35de2035b3879cbf9060c93bdca043428d76274_350.webp`,
    description: [
      '# Aero SMP!',
      "You know what this server is about. If you want to play Create Aeronautics in survival with no fluff, this is the server for you. Probably the most stable Create Aeronautics SMP!",
      '',
      '### A welcoming spawn',
      `![Welcoming Spawn](${cdn}/cached_images/2f90124f9f37f61ad2b82162ba44862a246bb12a.png)`,
      '',
      '### Cool factories',
      `![Cool Factories](${cdn}/cached_images/9ab3fa74c1aceaf9536a53012d05c10a2ce21880.png)`,
    ].join('\n'),
    links: [{ kind: 'discord', label: 'Discord', url: 'https://discord.gg/aerosmp', donation: false }],
    server: {
      address: 'play.aerosmp.com',
      content: {
        kind: 'modpack',
        projectId: AERO_SMP_ID,
        versionId: 'GDELFL7Y',
        projectName: 'Aero SMP',
        projectIcon: `${cdn}/${AERO_SMP_ID}/12b5d0ea9e6843746e703223699c3e429f8f6da6_96.webp`,
      },
      ping: { at: minutesAgo(95), online: 24, max: 300, versionName: 'Velocity 1.7.2-26.1.2', latencyMs: 551 },
      region: 'europe',
      languages: ['en'],
      plays2w: 4_159,
    },
  },
];

export const fixtureProjects: ResourceProject[] = [...modrinth, ...servers, ...curseforge,
  { ...project('luckperms', 'LuckPerms', 'plugin', 'Permissions for Bukkit servers.', 'Luck', 1_000_000, ['paper', 'spigot', 'bukkit', 'purpur'], 3), environment: { client: false, server: true, client_requirement: 'unsupported', server_requirement: 'required' } },
];

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
  // Server categories arrive as slugs, like Modrinth's own.
  category('smp', 'smp', '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14 20a4 4 0 0 1 7-2.5"/>', 'server'),
  category('pvp', 'pvp', '<path d="m14.5 17.5-11-11V3h3.5l11 11M13 19l6-6M16 16l4 4M19 21l2-2"/>', 'server'),
  category('competitive', 'competitive', '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/>', 'server'),
  category('social', 'social', '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 'server'),
  category('technical', 'technical', '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', 'server'),
  category('survival-mode', 'survival-mode', '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>', 'server'),
  category('minigames', 'minigames', '<rect x="3" y="7" width="18" height="11" rx="3"/><path d="M8 11v3M6.5 12.5h3M15 12h.01M18 13h.01"/>', 'server'),
  category('economy', 'economy', '<circle cx="12" cy="12" r="9"/><path d="M15 9.5a3 3 0 0 0-3-1.5c-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 0 1-3-1.5M12 6v12"/>', 'server'),
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

/** Aero SMP's own .mrpack releases (the listing pins 4.2); DonutSMP has none. */
const aeroReleases: [string, string, number, number, number][] = [
  ['GDELFL7Y', '4.2', 53, 10_712_797, 9_953],
  ['BI8N9kpm', '4.1', 97, 44_384_201, 8_653],
  ['tIXe5CrD', '4.0.1', 106, 44_384_043, 2_399],
  ['vZN4AGHe', '4.0', 107, 44_384_028, 491],
  ['Rc7fijGX', '3.5', 141, 10_705_554, 7_575],
  ['oQ5KIVNw', '3.4', 153, 10_682_653, 3_387],
];

export function fixtureVersions(projectId: string): ResourceVersion[] {
  if (projectId === DONUT_SMP_ID) return [];
  if (projectId === AERO_SMP_ID)
    return aeroReleases.map(([id, number, age, size, downloads]) => ({
      id,
      project_id: projectId,
      version_number: number,
      game_versions: ['1.21.1'],
      loaders: ['neoforge'],
      download_url: `https://example.invalid/aero-smp-${number}.mrpack`,
      file_name: `Aero SMP-${number}.mrpack`,
      release_type: 'release',
      published_at: ago(age),
      download_count: downloads,
      file_size: size,
      files: [],
      dependencies: [],
    }));
  if (projectId === 'luckperms') return [{ id: 'lp-5', project_id: projectId, version_number: '5.4', game_versions: ['1.21.4'], loaders: ['bukkit', 'paper', 'spigot', 'purpur'], download_url: 'https://example.invalid/LuckPerms.jar', file_name: 'LuckPerms.jar', release_type: 'release', dependencies: [] }];
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
