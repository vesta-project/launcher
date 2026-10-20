import {
  Button, Checkbox, Dialog, Menu, MenuCheckboxItem, MenuItem, MenuSeparator,
  OverlayMount, Select, Switch, Tab, TabList, TabPanel, Tabs, TextField,
} from '@vesta/ui';
import { Row, Stack } from '@workbench/kit';
import type { Story, StoryMeta } from '@workbench/story';
import { createSignal } from 'solid-js';
import './theme-contract.css';
import './themes/windows-2000.css';

const channels = [
  { value: 'release', label: 'Release' },
  { value: 'snapshot', label: 'Snapshot' },
  { value: 'unavailable', label: 'Unavailable channel', disabled: true },
];

/** Both samples use this composition, including the same local portal boundary. */
function ContractSample(props: { candidate?: boolean; classic?: boolean }) {
  const [name, setName] = createSignal('Survival', { name: 'themeProofName' });
  const [channel, setChannel] = createSignal('release', { name: 'themeProofChannel' });
  const [updates, setUpdates] = createSignal(true, { name: 'themeProofUpdates' });
  const [tray, setTray] = createSignal(false, { name: 'themeProofTray' });
  const [mixed, setMixed] = createSignal(true, { name: 'themeProofMixed' });
  const [open, setOpen] = createSignal(false, { name: 'themeProofDialog' });
  const [applies, setApplies] = createSignal(0, { name: 'themeProofApplies' });
  // Create the mount before its consumers, just like the workbench's SchemeOverlays.
  const mount = (<div data-theme-proof-overlays="" />) as HTMLDivElement;

  return (
    <section
      class="theme-proof-sample"
      data-theme-proof={props.candidate ? 'candidate' : 'reference'}
      data-vesta-theme-example={props.classic ? 'windows-2000' : undefined}
      data-vesta-scheme={props.classic ? 'light' : undefined}
      aria-label={props.candidate ? 'Theme candidate' : 'Current reference'}
    >
      <OverlayMount mount={mount}>
        <Stack gap={16}>
          <header class="theme-proof-heading">
            <h3>{props.candidate ? 'Theme candidate' : 'Current reference'}</h3>
            <p>Same controls, content and behaviour. All actions are local to this demo.</p>
          </header>
          <fieldset class="theme-proof-group">
            <legend>Instance preferences</legend>
            <Stack gap={12}>
              <TextField label="Instance name" value={name()} onChange={setName} />
              <Select label="Release channel" options={channels} value={channel()} onChange={setChannel} />
              <Checkbox label="Check for updates" checked={updates()} onChange={setUpdates} />
              <Switch label="Keep running in the tray" checked={tray()} onChange={setTray} />
              <Checkbox
                label="Partially selected resources"
                indeterminate={mixed()}
                onChange={() => setMixed(false)}
              />
            </Stack>
          </fieldset>
          <fieldset class="theme-proof-group">
            <legend>Validation and disabled controls</legend>
            <Stack gap={12}>
              <TextField label="Invalid path example" defaultValue="/missing/game" error="Choose an existing game folder." />
              <TextField label="Managed path" defaultValue="/managed/java" disabled />
              <Checkbox label="Disabled option" defaultChecked disabled />
              <Row>
                <Button disabled>Unavailable</Button>
                <Button tone="danger" variant="outline" onClick={() => setApplies(0)}>Reset demo count</Button>
              </Row>
            </Stack>
          </fieldset>
          <Tabs defaultValue="general" size="sm">
            <TabList aria-label="Example preference pages">
              <Tab value="general">General</Tab>
              <Tab value="advanced">Advanced</Tab>
              <Tab value="locked" disabled>Locked</Tab>
            </TabList>
            <TabPanel value="general">Preferences apply to this instance only.</TabPanel>
            <TabPanel value="advanced">A longer localized label should remain readable at increased zoom.</TabPanel>
            <TabPanel value="locked">Unavailable.</TabPanel>
          </Tabs>
          <Row>
            <Button tone="accent" onClick={() => setApplies((count) => count + 1)}>Apply changes</Button>
            <Menu trigger={(trigger) => <Button {...trigger} variant="outline">Options</Button>}>
              <MenuCheckboxItem checked={updates()} onChange={setUpdates}>Check for updates</MenuCheckboxItem>
              <MenuItem onSelect={() => setName('Survival')}>Restore example name</MenuItem>
              <MenuItem disabled>Unavailable action</MenuItem>
              <MenuSeparator />
              <MenuItem tone="danger" onSelect={() => setApplies(0)}>Reset demo count</MenuItem>
            </Menu>
            <Dialog
              title="Instance preferences"
              description="The dialog and its dropdown should inherit the same theme. Nothing is saved."
              open={open()}
              onOpenChange={setOpen}
              trigger={(trigger) => <Button {...trigger} variant="outline">Open dialog</Button>}
              footer={<Button onClick={() => setOpen(false)}>Close</Button>}
            >
              <Stack gap={12}>
                <TextField label="Dialog instance name" value={name()} onChange={setName} />
                <Select label="Dialog release channel" options={channels} value={channel()} onChange={setChannel} />
                <Checkbox label="Dialog update checks" checked={updates()} onChange={setUpdates} />
              </Stack>
            </Dialog>
          </Row>
          <output class="theme-proof-output" aria-live="polite">Apply presses: {applies()}</output>
        </Stack>
      </OverlayMount>
      {mount}
    </section>
  );
}

const AuthorStylesheet: Story = {
  name: 'Author stylesheet capability',
  description: 'A trusted, bundled CSS proof—not theme upload support. Classic uses a fixed light palette. Switch it off to test state retention and restoration; menus and dialogs have a mount inside each sample.',
  render: () => {
    const [classic, setClassic] = createSignal(true, { name: 'themeProofClassic' });
    return (
      <Stack>
        <Switch label="Classic author stylesheet (development only)" checked={classic()} onChange={setClassic} />
        <div class="theme-proof-comparison">
          <ContractSample />
          <ContractSample candidate classic={classic()} />
        </div>
      </Stack>
    );
  },
};

export default {
  title: 'Foundations/Theme contract',
  stories: { AuthorStylesheet },
} satisfies StoryMeta;
