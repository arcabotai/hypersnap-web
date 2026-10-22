import { useSuspenseQuery } from '@tanstack/react-query';

import { useQuorumApiClient } from '../../../components/context/QuorumApiContext';
import { buildChannelFetcher } from './buildChannelFetcher';
import { buildChannelKey } from './buildChannelKey';

const useChannel = ({
  spaceId,
  channelId,
}: {
  spaceId: string;
  channelId: string;
}) => {
  useQuorumApiClient();

  return useSuspenseQuery({
    queryKey: buildChannelKey({ spaceId, channelId }),
    queryFn: buildChannelFetcher(),
    refetchOnMount: true,
  });
};

export { useChannel };
