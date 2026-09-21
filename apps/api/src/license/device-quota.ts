import type { PoolClient } from 'pg';

export type DeviceChannel = 'desktop' | 'web' | 'mobile';

export const deviceChannels = ['desktop', 'web', 'mobile'] as const;

function channelLimitColumn(channel: DeviceChannel) {
  if (channel === 'desktop') return 'max_desktop_devices';
  if (channel === 'web') return 'max_web_devices';
  return 'max_mobile_devices';
}

export async function assertDeviceSlotAvailable(
  client: PoolClient,
  license: any,
  channel: DeviceChannel,
) {
  const counts = (await client.query(
    `select
       count(*) filter(where status='active')::int total,
       count(*) filter(where status='active' and channel=$2)::int channel_total
     from license_devices
     where license_id=$1`,
    [license.id, channel],
  )).rows[0];

  const total = Number(counts?.total ?? 0);
  const channelTotal = Number(counts?.channel_total ?? 0);
  const maxTotal = Number(license.max_devices ?? 0);
  const rawChannelLimit = license[channelLimitColumn(channel)];
  const maxChannel = rawChannelLimit == null ? null : Number(rawChannelLimit);

  if (maxTotal >= 0 && total >= maxTotal) {
    throw Object.assign(new Error('The license total device limit has been reached.'), {
      statusCode: 409,
      code: 'DEVICE_LIMIT_REACHED',
      limit_scope: 'total',
      device_channel: channel,
      active_devices: total,
      max_devices: maxTotal,
    });
  }

  if (maxChannel != null && channelTotal >= maxChannel) {
    throw Object.assign(new Error(`The ${channel} device limit has been reached.`), {
      statusCode: 409,
      code: 'DEVICE_LIMIT_REACHED',
      limit_scope: 'channel',
      device_channel: channel,
      active_devices: channelTotal,
      max_devices: maxChannel,
    });
  }
}
