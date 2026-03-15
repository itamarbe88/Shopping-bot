import React from "react";
import { SvgXml } from "react-native-svg";

const xml = `<svg width="680" height="680" viewBox="0 0 680 680" xmlns="http://www.w3.org/2000/svg">
  <rect x="140" y="60" width="400" height="400" rx="72" fill="white" stroke="#e0e0e0" stroke-width="1.5"/>
  <path d="M185 175 Q185 148 210 148 L310 148" fill="none" stroke="#1a6dbf" stroke-width="18" stroke-linecap="round"/>
  <path d="M205 175 L245 340 Q250 358 270 358 L460 358 Q478 358 483 340 L510 195 Q513 175 492 175 Z" fill="#3a9de0" stroke="#1a6dbf" stroke-width="3"/>
  <line x1="215" y1="235" x2="503" y2="235" stroke="#1a6dbf" stroke-width="1.5" opacity="0.45"/>
  <line x1="225" y1="295" x2="498" y2="295" stroke="#1a6dbf" stroke-width="1.5" opacity="0.45"/>
  <line x1="300" y1="175" x2="270" y2="358" stroke="#1a6dbf" stroke-width="1.5" opacity="0.45"/>
  <line x1="358" y1="175" x2="353" y2="358" stroke="#1a6dbf" stroke-width="1.5" opacity="0.45"/>
  <line x1="416" y1="175" x2="421" y2="358" stroke="#1a6dbf" stroke-width="1.5" opacity="0.45"/>
  <circle cx="288" cy="400" r="28" fill="#1a6dbf" stroke="#0a3a80" stroke-width="3"/>
  <circle cx="288" cy="400" r="12" fill="white"/>
  <circle cx="438" cy="400" r="28" fill="#1a6dbf" stroke="#0a3a80" stroke-width="3"/>
  <circle cx="438" cy="400" r="12" fill="white"/>
  <path d="M356 276 Q338 280 318 276 Q298 270 282 258 Q270 248 268 238 Q272 244 280 252 Q298 264 318 270 Q338 276 356 274" fill="none" stroke="#1a1a1a" stroke-width="1" stroke-linecap="round" opacity="0.9"/>
  <path d="M356 277 Q336 282 315 278 Q293 272 276 259 Q263 248 261 236 Q265 243 274 251 Q293 265 315 272 Q337 278 356 275" fill="none" stroke="#2a2a2a" stroke-width="0.8" stroke-linecap="round" opacity="0.8"/>
  <path d="M261 236 Q252 222 248 206 Q246 192 250 184 Q254 178 258 184 Q261 192 260 206 Q259 220 261 236" fill="none" stroke="#1a1a1a" stroke-width="1.1" stroke-linecap="round"/>
  <path d="M250 184 Q247 178 248 172 Q250 167 253 170 Q255 175 252 182" fill="none" stroke="#1a1a1a" stroke-width="0.6" stroke-linecap="round" opacity="0.7"/>
  <path d="M360 276 Q378 280 398 276 Q418 270 434 258 Q446 248 448 238 Q444 244 436 252 Q418 264 398 270 Q378 276 360 274" fill="none" stroke="#1a1a1a" stroke-width="1" stroke-linecap="round" opacity="0.9"/>
  <path d="M360 277 Q380 282 401 278 Q423 272 440 259 Q453 248 455 236 Q451 243 442 251 Q423 265 401 272 Q379 278 360 275" fill="none" stroke="#2a2a2a" stroke-width="0.8" stroke-linecap="round" opacity="0.8"/>
  <path d="M455 236 Q464 222 468 206 Q470 192 466 184 Q462 178 458 184 Q455 192 456 206 Q457 220 455 236" fill="none" stroke="#1a1a1a" stroke-width="1.1" stroke-linecap="round"/>
  <path d="M466 184 Q469 178 468 172 Q466 167 463 170 Q461 175 464 182" fill="none" stroke="#1a1a1a" stroke-width="0.6" stroke-linecap="round" opacity="0.7"/>
</svg>`;

interface Props {
  size?: number;
}

export default function CartIcon({ size = 120 }: Props) {
  return <SvgXml xml={xml} width={size} height={size} />;
}
