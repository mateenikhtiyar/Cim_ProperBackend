import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ClassificationService {
  async classify(description: string) {
    const prompt = `You are an expert M&A industry classifier. Based on the company description provided, classify the company using this exact two-level taxonomy:

## M&A INDUSTRY TAXONOMY

### 1. Technology & Software
- Enterprise Software - ERP, CRM, HCM, SCM, business intelligence, workflow automation, etc.
- Infrastructure Software - Operating systems, databases, middleware, security software, cloud platforms, etc.
- Consumer Software - Mobile apps, gaming, social media, entertainment software, etc.
- Hardware & Semiconductors - Computer hardware, networking equipment, chips, electronic components, etc.
- Telecommunications - Telecom services, equipment, wireless infrastructure, satellite communications, etc.
- Emerging Technologies - AI/ML, blockchain, IoT, robotics, quantum computing, AR/VR, etc.

### 2. Healthcare & Life Sciences
- Pharmaceuticals - Drug development, generic drugs, specialty pharmaceuticals, vaccines, etc.
- Medical Devices - Diagnostic equipment, surgical instruments, implantable devices, wearables, etc.
- Healthcare Services - Hospitals, clinics, telemedicine, home healthcare, urgent care, etc.
- Biotechnology - Gene therapy, cell therapy, molecular diagnostics, research tools, etc.
- Healthcare IT - Electronic health records, healthcare analytics, digital health platforms, etc.
- Medical Supplies - Consumables, personal protective equipment, laboratory supplies, etc.

### 3. Financial Services
- Banking - Commercial banks, investment banks, regional banks, credit unions, etc.
- Insurance - Life, property & casualty, health, reinsurance, insurance technology, etc.
- Asset Management - Mutual funds, hedge funds, private equity, wealth management, etc.
- Financial Technology - Payment processing, lending platforms, digital banking, blockchain finance, etc.
- Real Estate Finance - REITs, mortgage companies, real estate investment, property management, etc.
- Specialty Finance - Equipment financing, factoring, merchant cash advances, consumer credit, etc.

### 4. Industrial & Manufacturing
- Aerospace & Defense - Aircraft manufacturing, defense contractors, space technology, military equipment, aerospace supply chain, etc.
- Automotive - Vehicle manufacturing, auto parts, electric vehicles, autonomous driving technology, etc.
- Heavy Machinery - Construction equipment, agricultural machinery, mining equipment, industrial tools, etc.
- Materials, Chemicals & Mining - Specialty chemicals, commodities, plastics, metals, building materials, mining operations, resource extraction, etc.
- Energy Equipment - Oil & gas equipment, renewable energy hardware, power generation equipment, etc.
- Industrial Services - Contract manufacturing, equipment rental, maintenance services, industrial automation, specialized industrial solutions, etc.

### 5. Consumer & Retail
- Retail - Department stores, specialty retail, e-commerce, grocery, discount retail, etc.
- Consumer Brands - Apparel, footwear, accessories, home goods, personal care products, etc.
- Food & Beverage - Food processing, restaurants, beverages, agricultural products, food technology, etc.
- Media & Entertainment - Streaming services, content production, gaming, sports, publishing, etc.
- Hospitality & Travel - Hotels, airlines, travel agencies, cruise lines, entertainment venues, etc.
- Consumer Services - Education services, fitness, beauty services, home services, etc.

### 6. Energy & Utilities
- Oil & Gas - Upstream exploration, midstream transport, downstream refining, oilfield services, etc.
- Renewable Energy - Solar, wind, hydroelectric, energy storage, green hydrogen, etc.
- Electric Utilities - Power generation, transmission, distribution, grid modernization, etc.
- Energy Trading - Commodity trading, energy markets, risk management, energy finance, etc.
- Water & Waste - Water utilities, waste management, environmental services, recycling, etc.
- Energy Technology - Smart grid, energy efficiency, carbon capture, energy management software, etc.

### 7. Real Estate & Construction
- Commercial Real Estate - Office buildings, retail properties, industrial facilities, data centers, etc.
- Residential Real Estate - Home building, residential development, property management, senior housing, etc.
- Construction - General contracting, specialty trades, construction materials, civil engineering, subcontracting, etc.
- Real Estate Services - Brokerage, appraisal, property management, real estate technology, etc.
- Infrastructure - Transportation infrastructure, public works, environmental infrastructure, etc.
- REITs & Real Estate Investment - Public REITs, private real estate funds, real estate crowdfunding, etc.

### 8. Transportation & Logistics
- Shipping, Freight & Distribution - Ocean shipping, trucking, rail transport, air cargo, freight brokerage, product distribution, wholesaling, etc.
- Logistics Services - Third-party logistics, warehousing, distribution, supply chain management, etc.
- Transportation Technology - Fleet management, route optimization, autonomous vehicles, logistics software, etc.
- Public Transportation - Airlines, mass transit, ride sharing, mobility services, etc.
- Maritime & Ports - Port operations, marine services, shipbuilding, offshore services, etc.
- Last-Mile Delivery - Package delivery, food delivery, local logistics, drone delivery, etc.

### 9. Professional Services
- Consulting - Management consulting, IT consulting, strategy consulting, operations consulting, etc.
- Legal & Regulatory - Law firms, legal technology, compliance services, regulatory consulting, etc.
- Accounting & Tax - Accounting firms, tax services, audit services, financial advisory, etc.
- Marketing & Advertising - Digital marketing, advertising agencies, public relations, market research, etc.
- Human Resources - Staffing, recruiting, HR technology, workforce management, benefits administration, etc.
- Business Process Outsourcing - Call centers, data processing, document management, shared services, etc.

### 10. Government & Non-Profit
- Government Services - Federal contractors, state and local services, public sector technology, etc.
- Defense & Security - Cybersecurity, physical security, surveillance, emergency services, etc.
- Education - K-12 education, higher education, educational technology, vocational training, etc.
- Healthcare & Social Services - Public health, social services, non-profit healthcare, community services, etc.
- Environmental & Regulatory - Environmental consulting, regulatory compliance, public policy, etc.
- International & Trade - Export/import services, international development, trade finance, etc.

## CLASSIFICATION RULES:
1. Choose only ONE classification in the format: "Category → Subcategory"
2. Focus on the company's PRIMARY business model and core revenue drivers
3. Consider what type of buyer would be most interested in acquiring this company
4. Look at comparable companies and valuation methodologies that would apply

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
          model: 'claude-3-haiku-20240307',
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
      console.error("Error calling Anthropic API:", error.response?.data || error.message);
      throw new HttpException(
        `AI service request failed: ${error.response?.data?.error?.message || error.message}`,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
