import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  async classify(description: string) {
    const prompt = `You are an expert M&A industry classifier. Based on the company description provided, classify the company using this exact two-level taxonomy:

## M&A INDUSTRY TAXONOMY

### 1. Technology & Software
- Enterprise Software - ERP, CRM, HCM, SCM, business intelligence, workflow automation, project management platforms, etc.
- Infrastructure Software - Operating systems, databases, middleware, security software, cloud platforms, DevOps tools, etc.
- Consumer Software - Mobile apps, gaming, social media, entertainment software, personal productivity apps, etc.
- Hardware & Semiconductors - Computer hardware, networking equipment, chips, electronic components, IT hardware refurbishment, etc.
- Telecommunications - Telecom services, equipment, wireless infrastructure, satellite communications, carrier services, etc.
- Emerging Technologies - AI/ML, blockchain, IoT, robotics, quantum computing, AR/VR, digital transformation services, etc.

### 2. Healthcare & Life Sciences
- Pharmaceuticals - Drug development, generic drugs, specialty pharmaceuticals, vaccines, CDMO/contract manufacturing, ANDA portfolios, etc.
- Medical Devices - Diagnostic equipment, surgical instruments, implantable devices, wearables, etc.
- Healthcare Services - Hospitals, clinics, telemedicine, home healthcare, urgent care, surgical centers, pain management, behavioral health, etc.
- Biotechnology - Gene therapy, cell therapy, molecular diagnostics, research tools, etc.
- Healthcare IT - Electronic health records, healthcare analytics, digital health platforms, etc.
- Medical Supplies - Consumables, personal protective equipment, laboratory supplies, etc.

### 3. Financial Services
- Banking - Commercial banks, investment banks, regional banks, credit unions, etc.
- Insurance - Life, property & casualty, health, reinsurance, insurance technology, insurance marketing organizations (IMOs), etc.
- Asset Management - Mutual funds, hedge funds, private equity, wealth management, etc.
- Financial Technology - Payment processing, lending platforms, digital banking, payment orchestration, blockchain finance, etc.
- Real Estate Finance - REITs, mortgage companies, real estate investment, property management finance, etc.
- Specialty Finance - Equipment financing, factoring, merchant cash advances, consumer credit, specialty lending, etc.

### 4. Industrial & Manufacturing
- Aerospace & Defense - Aircraft manufacturing, defense contractors, space technology, military equipment, aerospace supply chain, etc. NOTE: For lift equipment, cranes, and non-aerospace machinery, use Heavy Machinery instead.
- Automotive - Vehicle manufacturing, auto parts, electric vehicles, autonomous driving technology, fleet vehicles, truck hire/rental, etc.
- Heavy Machinery - Construction equipment, agricultural machinery, mining equipment, industrial tools, lift equipment, cranes, material handling equipment, etc.
- Materials, Chemicals & Mining - Specialty chemicals, commodities, plastics, metals, building materials, mining operations, resource extraction, ethanol production, metalworking, etc.
- Energy Equipment - Oil & gas equipment, renewable energy hardware, power generation equipment, oilfield machining & tool making, etc.
- Industrial Services - Contract manufacturing, equipment rental, maintenance services, industrial automation, rope access & specialty access services, etc. NOTE: For HVAC, plumbing, electrical, roofing, and similar building trades, use 'Specialty Trade Contractors' under Real Estate & Construction.
- Building Products Manufacturing - Windows, doors, patio doors, architectural & landscape lighting, flooring products, roofing materials, signage & graphics manufacturing, display manufacturing, etc.

### 5. Consumer & Retail
- Retail - Department stores, specialty retail, e-commerce, grocery, discount retail, travel centers, convenience stores, Shopify/DTC commerce, etc.
- Consumer Brands - Apparel, footwear, accessories, home goods, personal care products, outdoor/recreation products, oral care, giftware, firearms & sporting goods, etc.
- Food & Beverage - Food processing, restaurants, QSR/franchise restaurants, beverages, non-alcoholic beverages, meat processing & distribution, agricultural products, food technology, water filtration, etc.
- Media & Entertainment - Streaming services, content production, gaming, sports, publishing, B2B publishing, etc.
- Hospitality & Travel - Hotels, airlines, travel agencies, cruise lines, entertainment venues, online travel agencies (OTAs), golf courses, leisure destinations, etc.
- Consumer Services - Education services, fitness, beauty services, home services, curtains/blinds/upholstery, soft furnishings, etc.
- Wholesale & Distribution - Product distributors, wholesale suppliers, promotional merchandise, trade-exclusive supply, import/export distribution, food & beverage distribution. NOTE: For trucking, freight, and logistics services, use Transportation & Logistics categories.

### 6. Energy & Utilities
- Oil & Gas - Upstream exploration, midstream transport, downstream refining, oilfield services, etc.
- Renewable Energy - Solar, wind, hydroelectric, energy storage, green hydrogen, etc.
- Electric Utilities - Power generation, transmission, distribution, grid modernization, etc.
- Energy Trading - Commodity trading, energy markets, risk management, energy finance, etc.
- Water & Waste - Water utilities, waste management, environmental services, recycling, etc.
- Energy Technology - Smart grid, energy efficiency, carbon capture, energy management software, etc.

### 7. Real Estate & Construction
- Commercial Real Estate - Office buildings, retail properties, industrial facilities, data centers, etc. NOTE: Golf courses and leisure venues belong under Hospitality & Travel.
- Residential Real Estate - Home building, residential development, property management, senior housing, lifestyle-focused homebuilders, etc.
- Construction - General contracting (commercial & public sector), mission-critical construction, design-build firms. NOTE: For specialty trades (HVAC, plumbing, electrical, roofing, etc.), use 'Specialty Trade Contractors'. For underground utilities and site work, use 'Civil Engineering & Site Work'.
- Specialty Trade Contractors - HVAC, plumbing, electrical, roofing, concrete & masonry, demolition, MEP (mechanical/electrical/plumbing), flooring installation, painting, fire protection installation, residential & commercial trade services.
- Civil Engineering & Site Work - Underground utilities, site development, earthwork, land clearing, grading, paving, civil infrastructure, civil repair & maintenance, environmental remediation site work.
- Real Estate Services - Brokerage, appraisal, property management, real estate technology, etc.
- Infrastructure - Transportation infrastructure, public works, environmental infrastructure, etc.
- REITs & Real Estate Investment - Public REITs, private real estate funds, real estate crowdfunding, etc.

### 8. Transportation & Logistics
- Shipping, Freight & Distribution - Ocean shipping, trucking, rail transport, air cargo, freight brokerage, tractor/driver outsourcing, 3PL services. NOTE: For product wholesalers and distributors (companies that buy and resell goods), use 'Wholesale & Distribution' under Consumer & Retail.
- Logistics Services - Third-party logistics, warehousing, distribution centers, supply chain management, etc.
- Transportation Technology - Fleet management, route optimization, autonomous vehicles, logistics software, etc.
- Public Transportation - Airlines, mass transit, ride sharing, mobility services, vehicle rental for ride-sharing operators, etc.
- Maritime & Ports - Port operations, marine services, shipbuilding, offshore services, etc.
- Last-Mile Delivery - Package delivery, food delivery, local logistics, final-mile logistics, drone delivery, etc.

### 9. Professional Services
- Consulting - Management consulting, IT consulting, strategy consulting, operations consulting, SPAC advisory, public-market readiness, etc.
- Legal & Regulatory - Law firms, legal technology, compliance services, regulatory consulting, etc.
- Accounting & Tax - Accounting firms, tax services, audit services, financial advisory, etc.
- Marketing & Advertising - Digital marketing agencies, advertising agencies, public relations, market research, experiential marketing, trade show services, SaaS survey platforms, etc.
- Human Resources - HR technology, workforce management, benefits administration, human capital consulting, organizational culture consulting, etc. NOTE: For staffing agencies and recruiting firms, use 'Staffing & Recruiting'.
- Staffing & Recruiting - Light industrial staffing, warehouse staffing, specialist labour recruitment, executive recruiting, temp staffing agencies, staffing for specific verticals (healthcare, IT, trades, etc.).
- Business Process Outsourcing - Call centers, data processing, document management, shared services, CX/customer experience outsourcing, etc.

### 10. Government & Non-Profit
- Government Services - Federal contractors, state and local services, public sector technology, etc.
- Defense & Security - Cybersecurity, physical security, surveillance, emergency services, alarm monitoring, AV/security installation, life safety systems, fire protection services. NOTE: This covers both government and commercial security services.
- Education - K-12 education, higher education, educational technology, vocational training, rope access & safety training, etc.
- Healthcare & Social Services - Public health, social services, non-profit healthcare, community services, etc.
- Environmental & Regulatory - Environmental consulting, regulatory compliance, public policy, etc.
- International & Trade - Export/import services, international development, trade finance, etc.

## CLASSIFICATION RULES:
1. Choose only ONE classification in the format: "Category → Subcategory"
2. Focus on the company's PRIMARY business model and core revenue drivers
3. Consider what type of buyer would be most interested in acquiring this company
4. Look at comparable companies and valuation methodologies that would apply
5. Pay close attention to the NOTE guidance on certain subcategories to avoid common misclassifications

## RESPONSE FORMAT:
Provide your response in exactly this JSON format:
{
  "classification": "Category → Subcategory",
  "reasoning": "Brief explanation of why this classification is most appropriate from an M&A perspective, including business model, comparable companies, and buyer considerations."
}

Company Description: ${description}`;

    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
        },
      );

      const text = response.data.content[0].text;
      const match = text.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : { error: 'Invalid response from AI model.' };
    } catch (error) {
      this.logger.error(`Error calling Anthropic API: ${error.response?.data?.error?.message || error.message}`);
      throw new HttpException(
        `AI service request failed: ${error.response?.data?.error?.message || error.message}`,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
