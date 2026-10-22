import {
  QuorumApiClient,
  Fetcher,
  OnError,
  OnFetchStart,
  OnSuccess,
  OnTimeout,
} from '../../api/baseTypes';
import { createContext, ReactNode, useContext } from 'react';
import { getConfig } from '../../config/config';

export type QuorumApiClientContextValue = {
  apiClient: QuorumApiClient;
  baseUrl: string;
  signMessage: SignMessage;
};

export type SignMessage = (message: string) => Promise<string>;

export const QuorumApiClientContext =
  createContext<QuorumApiClientContextValue>({
    apiClient: new QuorumApiClient({
      baseUrl: getConfig().quorumApiUrl,
      wsUrl: getConfig().quorumWsUrl,
      debug: false,
      timeoutRetryDecayFactor: 0.3,
    }),
    baseUrl: getConfig().quorumApiUrl,
    signMessage: async () => '',
  });

export type QuorumApiClientProviderProps = {
  address: string | undefined;
  baseUrl?: string;
  wsUrl?: string;
  children: ReactNode;
  debug?: boolean;
  fetch?: Fetcher;
  mutateTimeout?: number;
  onError?: OnError;
  onFetchStart?: OnFetchStart;
  onSuccess?: OnSuccess;
  onTimeout?: OnTimeout;
  readTimeout?: number;
  signMessage: SignMessage;
  timeoutRetryDecayFactor?: number;
  checkOffline?: () => Promise<boolean>;
};

export const useQuorumApiClient = () => useContext(QuorumApiClientContext);
