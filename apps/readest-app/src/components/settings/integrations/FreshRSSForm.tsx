import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { FreshRSSClient } from '@/services/freshrss/greaderClient';
import type { FreshRSSSettings } from '@/types/settings';
import SubPageHeader from '../SubPageHeader';
import { SectionTitle, SettingLabel, Tips } from '../primitives';

interface FreshRSSFormProps {
  onBack: () => void;
}

const FreshRSSForm: React.FC<FreshRSSFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const fr = settings.freshrss;
  const [serverUrl, setServerUrl] = useState(fr?.serverUrl ?? '');
  const [username, setUsername] = useState(fr?.username ?? '');
  const [apiPassword, setApiPassword] = useState(fr?.apiPassword ?? '');
  const [isTesting, setIsTesting] = useState(false);

  const persist = async (next: Partial<FreshRSSSettings>) => {
    const newSettings = { ...settings, freshrss: { ...settings.freshrss, ...next } };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const handleTestAndSave = async () => {
    setIsTesting(true);
    try {
      const client = new FreshRSSClient({
        serverUrl: serverUrl.trim(),
        username: username.trim(),
        apiPassword,
      });
      const { folders, feeds } = await client.listFoldersAndFeeds();
      const unread = feeds.reduce((n, f) => n + f.unreadCount, 0);
      await persist({ enabled: true, serverUrl: serverUrl.trim(), username: username.trim(), apiPassword });
      eventDispatcher.dispatch('toast', {
        message: _('Connected — {{folders}} folders, {{feeds}} feeds, {{unread}} unread', {
          folders: folders.length,
          feeds: feeds.length,
          unread,
        }),
        type: 'info',
      });
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        message: _('FreshRSS connection failed: {{error}}', { error: String(e) }),
        type: 'error',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const canTest = !!serverUrl.trim() && !!username.trim() && !!apiPassword;
  const isConfigured = !!fr?.serverUrl && !!fr?.apiPassword;

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('FreshRSS')}
        description={_(
          'Read your FreshRSS feeds inside Readest. In FreshRSS, enable the GReader API (Settings → Profile → API access) and set an API password.',
        )}
        onBack={onBack}
      />

      <div className='space-y-5'>
        <div className='space-y-1.5'>
          <SectionTitle as='label' htmlFor='freshrss-url' className='block'>
            {_('Server URL')}
          </SectionTitle>
          <input
            id='freshrss-url'
            type='url'
            inputMode='url'
            placeholder='https://rss.example.com'
            className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
            spellCheck='false'
            autoCapitalize='off'
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
          />
        </div>

        <div className='space-y-1.5'>
          <SectionTitle as='label' htmlFor='freshrss-user' className='block'>
            {_('Username')}
          </SectionTitle>
          <input
            id='freshrss-user'
            type='text'
            className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
            spellCheck='false'
            autoCapitalize='off'
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div className='space-y-1.5'>
          <SectionTitle as='label' htmlFor='freshrss-pass' className='block'>
            {_('API Password')}
          </SectionTitle>
          <input
            id='freshrss-pass'
            type='password'
            placeholder={_('FreshRSS API password')}
            className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
            spellCheck='false'
            value={apiPassword}
            onChange={(e) => setApiPassword(e.target.value)}
          />
        </div>

        <div className='flex justify-end'>
          <button
            type='button'
            onClick={handleTestAndSave}
            disabled={isTesting || !canTest}
            className={clsx(
              'btn btn-primary h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
              'focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-2',
              isTesting && 'opacity-60',
            )}
          >
            {isTesting ? (
              <span className='loading loading-spinner loading-sm' />
            ) : (
              _('Test Connection & Save')
            )}
          </button>
        </div>

        {isConfigured && (
          <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
            <div className='divide-base-200 divide-y'>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Enabled')}</SettingLabel>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={fr?.enabled ?? false}
                  onChange={() => persist({ enabled: !fr?.enabled })}
                />
              </label>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Export highlights to Obsidian')}</SettingLabel>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={fr?.exportToObsidian ?? false}
                  onChange={() => persist({ exportToObsidian: !fr?.exportToObsidian })}
                />
              </label>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Auto-advance when RSVP finishes')}</SettingLabel>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={fr?.autoAdvanceOnRsvpEnd ?? true}
                  onChange={() => persist({ autoAdvanceOnRsvpEnd: !fr?.autoAdvanceOnRsvpEnd })}
                />
              </label>
            </div>
          </div>
        )}

        <Tips>
          <li>
            {_(
              'Articles open as temporary documents — never added to your book library or synced via WebDAV.',
            )}
          </li>
          <li>
            {_(
              'Read/unread state lives in FreshRSS, so it stays in sync across all your devices and other readers.',
            )}
          </li>
        </Tips>
      </div>
    </div>
  );
};

export default FreshRSSForm;
