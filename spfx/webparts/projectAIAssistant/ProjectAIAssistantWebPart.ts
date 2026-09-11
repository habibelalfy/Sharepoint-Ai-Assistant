import * as React from 'react';
import * as ReactDom from 'react-dom';
import { Version } from '@microsoft/sp-core-library';
import { IPropertyPaneConfiguration, PropertyPaneTextField } from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import ProjectAIAssistant from './components/ProjectAIAssistant';
import { IProjectAIAssistantProps } from './components/IProjectAIAssistantProps';

export interface IProjectAIAssistantWebPartProps {
  mcpGatewayUrl: string;
}

export default class ProjectAIAssistantWebPart extends BaseClientSideWebPart<IProjectAIAssistantWebPartProps> {
  public render(): void {
    const element: React.ReactElement<IProjectAIAssistantProps> = React.createElement(
      ProjectAIAssistant,
      {
        mcpGatewayUrl: this.properties.mcpGatewayUrl,
        context: this.context,
      },
    );
    ReactDom.render(element, this.domElement);
  }

  protected onDispose(): void {
    ReactDom.unmountComponentAtNode(this.domElement);
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: { description: 'Project AI Assistant settings' },
          groups: [
            {
              groupName: 'Connection',
              groupFields: [
                PropertyPaneTextField('mcpGatewayUrl', {
                  label: 'MCP Gateway URL',
                }),
              ],
            },
          ],
        },
      ],
    };
  }
}
