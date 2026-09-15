'use client';
import { useState, useRef, useEffect } from 'react';
import { Icon } from '@/components/ui';

const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina',
  'Armenia','Australia','Austria','Azerbaijan','Bahamas','Bahrain','Bangladesh','Barbados',
  'Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina',
  'Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cabo Verde','Cambodia',
  'Cameroon','Canada','Central African Republic','Chad','Chile','China','Colombia',
  'Comoros','Congo (Democratic Republic)','Congo (Republic)','Costa Rica','Croatia',
  'Cuba','Cyprus','Czech Republic','Denmark','Djibouti','Dominica','Dominican Republic',
  'Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini',
  'Ethiopia','Fiji','Finland','France','Gabon','Gambia','Georgia','Germany','Ghana',
  'Greece','Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana','Haiti','Honduras',
  'Hong Kong','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel',
  'Italy','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kiribati','Korea (North)',
  'Korea (South)','Kosovo','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Lesotho',
  'Liberia','Libya','Liechtenstein','Lithuania','Luxembourg','Macau','Madagascar',
  'Malawi','Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania',
  'Mauritius','Mexico','Micronesia','Moldova','Monaco','Mongolia','Montenegro',
  'Morocco','Mozambique','Myanmar','Namibia','Nauru','Nepal','Netherlands',
  'New Zealand','Nicaragua','Niger','Nigeria','North Macedonia','Norway','Oman',
  'Pakistan','Palau','Palestine','Panama','Papua New Guinea','Paraguay','Peru',
  'Philippines','Poland','Portugal','Qatar','Romania','Russia','Rwanda',
  'Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Samoa',
  'San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia','Seychelles',
  'Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands','Somalia',
  'South Africa','South Sudan','Spain','Sri Lanka','Sudan','Suriname','Sweden',
  'Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand','Timor-Leste',
  'Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu',
  'Uganda','Ukraine','United Arab Emirates','United Kingdom','United States',
  'Uruguay','Uzbekistan','Vanuatu','Vatican City','Venezuela','Vietnam','Yemen',
  'Zambia','Zimbabwe',
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export function CountrySelect({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const filtered = COUNTRIES.filter(c =>
    c.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full h-[42px] px-3 rounded-control border border-rule bg-paper text-left text-sm text-ink flex items-center justify-between gap-2 transition-colors hover:border-accent focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent disabled:bg-pill disabled:text-muted"
      >
        <span className={`truncate ${value ? 'text-ink' : 'text-muted'}`}>
          {value || 'Select country…'}
        </span>
        <Icon name="chevronDown" size={16} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1.5 bg-paper border border-rule rounded-card shadow-card overflow-hidden">
          <div className="p-2.5 border-b border-rule">
            <div className="relative">
              <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                ref={inputRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search countries…"
                aria-label="Search countries"
                className="w-full h-9 pl-9 pr-3 rounded-control border border-rule bg-paper text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto" role="listbox" aria-label="Countries">
            {filtered.length > 0 ? filtered.map(country => (
              <button
                key={country}
                type="button"
                role="option"
                aria-selected={value === country}
                onClick={() => { onChange(country); setOpen(false); setSearch(''); }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                  value === country
                    ? 'bg-tint text-accent font-semibold'
                    : 'text-ink hover:bg-page'
                }`}
              >
                {country}
                {value === country && <Icon name="check" size={16} strokeWidth={2.5} className="text-accent" />}
              </button>
            )) : (
              <div className="px-4 py-8 text-center text-sm text-muted">No countries match “{search}”</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
