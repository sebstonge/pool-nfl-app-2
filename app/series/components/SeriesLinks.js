'use client';
import {createContext,useContext} from 'react';
export const SeriesLinksContext=createContext(false);
export const usePublicSeriesUrls=()=>useContext(SeriesLinksContext);
